import { 
  ApolloClient, 
  InMemoryCache, 
  createHttpLink,
  split,
  ApolloLink,
  Observable,
  FetchResult,
  Operation,
} from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { RetryLink } from '@apollo/client/link/retry';
import { createClient } from 'graphql-ws';

// Get GraphQL endpoint from environment
const GRAPHQL_HTTP_ENDPOINT = process.env.NEXT_PUBLIC_GRAPHQL_HTTP_ENDPOINT || 'http://localhost:4000/graphql';
const GRAPHQL_WS_ENDPOINT = process.env.NEXT_PUBLIC_GRAPHQL_WS_ENDPOINT || 'ws://localhost:4000/graphql';

// Token management
const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(TOKEN_KEY);
  }
  return null;
}

export function setAuthToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function getRefreshToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }
  return null;
}

export function setRefreshToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  }
}

export function clearTokens(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

// Create HTTP link
const httpLink = createHttpLink({
  uri: GRAPHQL_HTTP_ENDPOINT,
  credentials: 'include',
});

// Create WebSocket link for subscriptions
const wsLink = typeof window !== 'undefined' 
  ? new GraphQLWsLink(
      createClient({
        url: GRAPHQL_WS_ENDPOINT,
        connectionParams: () => {
          const token = getAuthToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
        on: {
          connected: () => console.log('WebSocket connected'),
          error: (error) => console.error('WebSocket error:', error),
          closed: () => console.log('WebSocket closed'),
        },
      })
    )
  : null;

// Auth link to add token to requests
const authLink = setContext((_, { headers }) => {
  const token = getAuthToken();
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    },
  };
});

// Token refresh logic
async function refreshAuthToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(GRAPHQL_HTTP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          mutation RefreshToken($input: RefreshTokenInput!) {
            auth {
              refreshToken(input: $input) {
                accessToken
                refreshToken
                expiresIn
              }
            }
          }
        `,
        variables: {
          input: { refreshToken },
        },
      }),
    });

    const data = await response.json();
    if (data.data?.auth?.refreshToken) {
      const { accessToken, refreshToken: newRefreshToken } = data.data.auth.refreshToken;
      setAuthToken(accessToken);
      setRefreshToken(newRefreshToken);
      return accessToken;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }

  return null;
}

// Error handling with token refresh
const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (graphQLErrors) {
    for (const error of graphQLErrors) {
      // Handle authentication errors
      if (error.extensions?.code === 'UNAUTHENTICATED') {
        // Try to refresh token
        return new Observable<FetchResult>((observer) => {
          refreshAuthToken()
            .then((token) => {
              if (token) {
                // Retry the request with new token
                const oldHeaders = operation.getContext().headers;
                operation.setContext({
                  headers: {
                    ...oldHeaders,
                    authorization: `Bearer ${token}`,
                  },
                });
                
                const subscriber = {
                  next: observer.next.bind(observer),
                  error: observer.error.bind(observer),
                  complete: observer.complete.bind(observer),
                };
                
                forward(operation).subscribe(subscriber);
              } else {
                // Refresh failed, clear tokens and redirect to login
                clearTokens();
                window.location.href = '/login';
                observer.error(error);
              }
            })
            .catch((err) => {
              observer.error(err);
            });
        });
      }

      console.error(
        `GraphQL error: Message: ${error.message}, Code: ${error.extensions?.code}`
      );
    }
  }

  if (networkError) {
    console.error(`Network error: ${networkError}`);
  }
});

// Retry link for network failures
const retryLink = new RetryLink({
  delay: {
    initial: 300,
    max: Infinity,
    jitter: true,
  },
  attempts: {
    max: 3,
    retryIf: (error, _operation) => {
      return !!error && !graphQLErrors?.some(e => 
        e.extensions?.code === 'UNAUTHENTICATED' || 
        e.extensions?.code === 'FORBIDDEN'
      );
    },
  },
});

// Split link for HTTP and WebSocket
const splitLink = wsLink 
  ? split(
      ({ query }) => {
        const definition = getMainDefinition(query);
        return (
          definition.kind === 'OperationDefinition' &&
          definition.operation === 'subscription'
        );
      },
      wsLink,
      httpLink
    )
  : httpLink;

// Combine all links
const link = ApolloLink.from([
  errorLink,
  retryLink,
  authLink,
  splitLink,
]);

// Cache configuration
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        games: {
          keyArgs: ['status', 'gameMode', 'sortBy', 'sortOrder'],
          merge(existing, incoming, { args }) {
            if (!args?.pagination?.after) {
              // First page, replace existing
              return incoming;
            }
            // Append to existing for pagination
            return {
              ...incoming,
              edges: [...(existing?.edges || []), ...incoming.edges],
            };
          },
        },
        transactions: {
          keyArgs: ['filter', 'sortBy', 'sortOrder'],
          merge(existing, incoming, { args }) {
            if (!args?.pagination?.after) {
              return incoming;
            }
            return {
              ...incoming,
              edges: [...(existing?.edges || []), ...incoming.edges],
            };
          },
        },
      },
    },
    Game: {
      fields: {
        players: {
          keyArgs: false,
          merge(existing, incoming, { args }) {
            if (!args?.pagination?.after) {
              return incoming;
            }
            return {
              ...incoming,
              edges: [...(existing?.edges || []), ...incoming.edges],
            };
          },
        },
      },
    },
    User: {
      keyFields: ['id'],
    },
    Transaction: {
      keyFields: ['signature'],
    },
  },
});

// Create Apollo Client
export const apolloClient = new ApolloClient({
  link,
  cache,
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
    },
    query: {
      fetchPolicy: 'network-only',
      errorPolicy: 'all',
    },
    mutate: {
      errorPolicy: 'all',
    },
  },
});

// Helper to reset store (useful for logout)
export async function resetApolloStore(): Promise<void> {
  clearTokens();
  await apolloClient.resetStore();
}