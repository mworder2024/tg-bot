import { gql } from '@apollo/client';

// Fragments
export const USER_FRAGMENT = gql`
  fragment UserFields on User {
    id
    telegramId
    discordId
    username
    displayName
    walletAddress
    walletVerified
    roles
    createdAt
    updatedAt
    lastLoginAt
    isActive
    isBanned
    profile {
      avatar
      bio
      country
      language
      timezone
      preferences
    }
    stats {
      gamesPlayed
      gamesWon
      totalWinnings
      winRate
      currentStreak
      longestStreak
      favoriteGameMode
      lastGameAt
    }
  }
`;

export const AUTH_TOKEN_FRAGMENT = gql`
  fragment AuthTokenFields on AuthToken {
    accessToken
    refreshToken
    expiresIn
    tokenType
  }
`;

// Queries
export const ME = gql`
  ${USER_FRAGMENT}
  query Me {
    auth {
      me {
        ...UserFields
      }
    }
  }
`;

export const GET_USER = gql`
  ${USER_FRAGMENT}
  query GetUser($userId: String!) {
    auth {
      user(id: $userId) {
        ...UserFields
      }
    }
  }
`;

export const CHECK_USERNAME = gql`
  query CheckUsername($username: String!) {
    auth {
      checkUsername(username: $username)
    }
  }
`;

// Mutations
export const LOGIN = gql`
  ${USER_FRAGMENT}
  ${AUTH_TOKEN_FRAGMENT}
  mutation Login($input: LoginInput!) {
    auth {
      login(input: $input) {
        user {
          ...UserFields
        }
        token {
          ...AuthTokenFields
        }
      }
    }
  }
`;

export const GET_SIWS_CHALLENGE = gql`
  query GetSIWSChallenge($address: String!) {
    auth {
      getSIWSChallenge(address: $address) {
        message
        domain
        address
        statement
        uri
        version
        chainId
        nonce
        issuedAt
        expirationTime
      }
    }
  }
`;

export const VERIFY_SIWS = gql`
  ${USER_FRAGMENT}
  ${AUTH_TOKEN_FRAGMENT}
  mutation VerifySIWS($input: SIWSLoginInput!) {
    auth {
      verifySIWS(input: $input) {
        user {
          ...UserFields
        }
        token {
          ...AuthTokenFields
        }
      }
    }
  }
`;

export const REFRESH_TOKEN = gql`
  ${AUTH_TOKEN_FRAGMENT}
  mutation RefreshToken($input: RefreshTokenInput!) {
    auth {
      refreshToken(input: $input) {
        ...AuthTokenFields
      }
    }
  }
`;

export const LOGOUT = gql`
  mutation Logout {
    auth {
      logout {
        success
        message
      }
    }
  }
`;

export const UPDATE_PROFILE = gql`
  ${USER_FRAGMENT}
  mutation UpdateProfile($input: UpdateProfileInput!) {
    auth {
      updateProfile(input: $input) {
        ...UserFields
      }
    }
  }
`;

export const LINK_WALLET = gql`
  ${USER_FRAGMENT}
  mutation LinkWallet($address: String!, $signature: String!) {
    auth {
      linkWallet(address: $address, signature: $signature) {
        ...UserFields
      }
    }
  }
`;

export const UNLINK_WALLET = gql`
  ${USER_FRAGMENT}
  mutation UnlinkWallet {
    auth {
      unlinkWallet {
        ...UserFields
      }
    }
  }
`;