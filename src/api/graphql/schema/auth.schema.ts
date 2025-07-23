import { gql } from 'graphql-tag';

export const authTypeDefs = gql`
  type User {
    id: ID!
    walletAddress: String!
    username: String
    email: String
    isAdmin: Boolean!
    isVerified: Boolean!
    emailVerified: Boolean!
    phoneVerified: Boolean
    kycVerified: Boolean
    chain: String!
    createdAt: String!
    lastActive: String!
  }

  type AuthResponse {
    success: Boolean!
    token: String
    refreshToken: String
    user: User
    message: String
  }

  type MessageResponse {
    message: String!
    timestamp: String!
  }

  type VerificationResponse {
    success: Boolean!
    message: String!
  }

  input WalletAuthInput {
    walletAddress: String!
    signature: String!
    message: String!
    timestamp: String!
    chain: String
  }

  input RefreshTokenInput {
    refreshToken: String!
  }

  input EmailVerificationInput {
    email: String!
    code: String!
  }

  type Query {
    getAuthMessage(walletAddress: String!): MessageResponse!
    currentUser: User
  }

  type Mutation {
    connectWallet(input: WalletAuthInput!): AuthResponse!
    refreshToken(input: RefreshTokenInput!): AuthResponse!
    verifyEmail(input: EmailVerificationInput!): VerificationResponse!
    logout: VerificationResponse!
  }
`;

// Export authSchema as alias to authTypeDefs
export const authSchema = authTypeDefs;