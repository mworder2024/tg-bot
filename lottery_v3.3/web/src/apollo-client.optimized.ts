/**
 * Optimized Apollo Client configuration with performance enhancements
 */

import { ApolloClient, InMemoryCache, createHttpLink, split, from } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { BatchHttpLink } from '@apollo/client/link/batch-http';
import { RetryLink } from '@apollo/client/link/retry';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import { createClient } from 'graphql-ws';
import { persistCache, LocalStorageWrapper } from 'apollo3-cache-persist';
import { PersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { sha256 } from 'crypto-hash';

// Import optimized cache configuration
import GraphQLOptimizer, { defaultPerformanceConfig } from '../../../src/performance/graphql-optimizer';

const graphqlOptimizer = new GraphQLOptimizer(defaultPerformanceConfig.graphql);

// Environment variables
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:4000';

/**
 * Create optimized cache with field-level caching
 */
const createOptimizedCache = () => {
  return new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // Games with pagination
          games: {
            keyArgs: ['filter', 'sort'],
            merge(existing = { items: [], total: 0, hasMore: true }, incoming, { args }) {
              // Handle pagination
              if (args?.offset === 0) {
                return incoming; // Reset for new filter/sort
              }
              
              return {
                ...incoming,
                items: [...(existing.items || []), ...(incoming.items || [])],
                hasMore: incoming.hasMore,
              };
            },
          },
          
          // Analytics with TTL caching
          analytics: {
            keyArgs: ['timeRange', 'metrics'],
            read(existing, { field, cache, storage }) {
              if (!existing) return undefined;
              
              const cachedAt = storage?.get?.('analytics_cached_at');
              const now = Date.now();
              const ttl = 5 * 60 * 1000; // 5 minutes
              
              if (cachedAt && now - cachedAt > ttl) {
                return undefined; // Force refetch
              }
              
              return existing;
            },
            merge(existing, incoming, { storage }) {
              storage?.set?.('analytics_cached_at', Date.now());
              return incoming;
            },
          },
          
          // Blockchain data with short TTL
          blockchainStatus: {
            read(existing, { storage }) {
              if (!existing) return undefined;
              
              const cachedAt = storage?.get?.('blockchain_cached_at');
              const now = Date.now();
              const ttl = 30 * 1000; // 30 seconds
              
              if (cachedAt && now - cachedAt > ttl) {
                return undefined;
              }
              
              return existing;
            },
            merge(existing, incoming, { storage }) {
              storage?.set?.('blockchain_cached_at', Date.now());
              return incoming;
            },
          },
        },
      },
      
      Game: {
        keyFields: ['id'],
        fields: {
          participants: {
            merge(existing = [], incoming) {
              return [...incoming];
            },
          },
        },
      },
      
      User: {
        keyFields: ['id'],
        fields: {
          balance: {
            merge(existing, incoming) {
              return incoming;
            },
          },
        },
      },
      
      Transaction: {
        keyFields: ['signature'],
      },
    },
    
    possibleTypes: {
      Node: ['Game', 'User', 'Transaction'],
    },
  });
};

/**
 * Create HTTP link with batching and optimization
 */
const createHttpLink = () => {
  // Check if we should use batching based on network conditions
  const shouldBatch = () => {
    const connection = (navigator as any).connection;
    if (!connection) return true;
    
    // Use batching for slower connections
    return connection.effectiveType === '2g' || 
           connection.effectiveType === '3g' || 
           connection.saveData;
  };

  const httpLink = createHttpLink({
    uri: `${API_URL}/graphql`,
    credentials: 'include',
  });

  const batchLink = new BatchHttpLink({
    uri: `${API_URL}/graphql`,
    batchMax: 10,
    batchInterval: 20,
    batchKey: (operation) => {
      // Batch queries but not mutations/subscriptions
      const definition = getMainDefinition(operation.query);
      return definition.kind === 'OperationDefinition' && definition.operation === 'query'
        ? 'queries'
        : 'individual';
    },
  });

  return shouldBatch() ? batchLink : httpLink;
};

/**
 * Create WebSocket link for subscriptions
 */
const createWsLink = () => {
  return new GraphQLWsLink(
    createClient({
      url: `${WS_URL}/graphql`,
      connectionParams: () => ({
        authToken: localStorage.getItem('authToken'),
      }),
      retryAttempts: 5,
      shouldRetry: () => true,
    })
  );
};

/**
 * Create auth link
 */
const createAuthLink = () => {
  return setContext((_, { headers }) => {
    const token = localStorage.getItem('authToken');
    
    return {
      headers: {
        ...headers,
        ...(token && { authorization: `Bearer ${token}` }),
        'Apollo-Require-Preflight': 'true',
      },
    };
  });
};

/**
 * Create error link with retry logic
 */
const createErrorLink = () => {
  return onError(({ graphQLErrors, networkError, operation, forward }) => {
    if (graphQLErrors) {
      graphQLErrors.forEach(({ message, locations, path }) => {
        console.error(
          `GraphQL error: Message: ${message}, Location: ${locations}, Path: ${path}`
        );
      });
    }

    if (networkError) {
      console.error(`Network error: ${networkError}`);
      
      // Handle specific network errors
      if (networkError.message === 'Failed to fetch') {
        // Network is offline, try to use cached data
        console.info('Network offline, attempting to use cached data');
      }
    }
  });
};

/**
 * Create retry link with exponential backoff
 */
const createRetryLink = () => {
  return new RetryLink({
    delay: {
      initial: 300,
      max: Infinity,
      jitter: true,
    },
    attempts: {
      max: 3,
      retryIf: (error, _operation) => {
        return !!error && (
          error.statusCode === 503 ||
          error.statusCode === 504 ||
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('NetworkError')
        );
      },
    },
  });
};

/**
 * Create persisted query link for better caching
 */
const createPersistedQueryLink = () => {
  return createPersistedQueryLink({
    sha256,
    useGETForHashedQueries: true,
  });
};

/**
 * Initialize optimized Apollo Client
 */
export const initializeApolloClient = async () => {
  const cache = createOptimizedCache();
  
  // Set up cache persistence
  await persistCache({
    cache,
    storage: new LocalStorageWrapper(window.localStorage),
    maxSize: 10 * 1024 * 1024, // 10MB
    debug: process.env.NODE_ENV === 'development',
  });

  // Create links
  const httpLink = createHttpLink();
  const wsLink = createWsLink();
  const authLink = createAuthLink();
  const errorLink = createErrorLink();
  const retryLink = createRetryLink();
  const persistedQueryLink = createPersistedQueryLink();

  // Split link for subscriptions
  const splitLink = split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return (
        definition.kind === 'OperationDefinition' &&
        definition.operation === 'subscription'
      );
    },
    wsLink,
    httpLink
  );

  // Combine all links
  const link = from([
    errorLink,
    authLink,
    retryLink,
    persistedQueryLink,
    splitLink,
  ]);

  const client = new ApolloClient({
    link,
    cache,
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
        errorPolicy: 'all',
        notifyOnNetworkStatusChange: true,
      },
      query: {
        fetchPolicy: 'cache-first',
        errorPolicy: 'all',
      },
      mutate: {
        fetchPolicy: 'no-cache',
        errorPolicy: 'all',
      },
    },
    connectToDevTools: process.env.NODE_ENV === 'development',
  });

  // Warm up cache with critical queries
  await warmUpCache(client);

  return client;
};

/**
 * Warm up cache with critical queries
 */
const warmUpCache = async (client: ApolloClient<any>) => {
  try {
    // Prefetch current user data if authenticated
    const token = localStorage.getItem('authToken');
    if (token) {
      await client.query({
        query: require('./graphql/queries/currentUser.graphql'),
        fetchPolicy: 'network-only',
      });
    }

    // Prefetch system configuration
    await client.query({
      query: require('./graphql/queries/systemConfig.graphql'),
      fetchPolicy: 'network-only',
    });
  } catch (error) {
    console.warn('Cache warm-up failed:', error);
  }
};

/**
 * Get query options based on network conditions
 */
export const getOptimizedQueryOptions = () => {
  const connection = (navigator as any).connection;
  
  if (!connection) {
    return {
      fetchPolicy: 'cache-first' as const,
      errorPolicy: 'all' as const,
    };
  }

  // Optimize based on connection type
  switch (connection.effectiveType) {
    case '2g':
    case 'slow-2g':
      return {
        fetchPolicy: 'cache-only' as const,
        errorPolicy: 'ignore' as const,
      };
    
    case '3g':
      return {
        fetchPolicy: 'cache-first' as const,
        errorPolicy: 'all' as const,
        nextFetchPolicy: 'cache-only' as const,
      };
    
    case '4g':
      return {
        fetchPolicy: 'cache-and-network' as const,
        errorPolicy: 'all' as const,
      };
    
    default:
      return {
        fetchPolicy: 'cache-first' as const,
        errorPolicy: 'all' as const,
      };
  }
};

/**
 * Subscription options optimized for mobile
 */
export const getOptimizedSubscriptionOptions = () => {
  return {
    errorPolicy: 'all' as const,
    fetchPolicy: 'cache-and-network' as const,
    shouldResubscribe: () => true,
  };
};

/**
 * Clear cache utility
 */
export const clearCache = async (client: ApolloClient<any>) => {
  await client.clearStore();
  localStorage.removeItem('apollo-cache-persist');
  console.info('Apollo cache cleared');
};

export default initializeApolloClient;