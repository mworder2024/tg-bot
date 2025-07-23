import { gql } from '@apollo/client';

// Fragments
export const GAME_FRAGMENT = gql`
  fragment GameFields on Game {
    id
    gameId
    chatId
    creatorId
    status
    maxPlayers
    entryFee
    prizePool
    treasuryFee
    gameMode
    numberRangeStart
    numberRangeEnd
    remainingNumbers
    createdAt
    updatedAt
    startedAt
    completedAt
    solanaSignature
    escrowAccount
  }
`;

export const PLAYER_FRAGMENT = gql`
  fragment PlayerFields on Player {
    id
    userId
    username
    gameId
    selectedNumber
    status
    isWinner
    prizeAmount
    walletAddress
    paymentConfirmed
    paymentSignature
    eliminatedAt
    joinedAt
    createdAt
    updatedAt
  }
`;

// Queries
export const GET_GAME = gql`
  ${GAME_FRAGMENT}
  query GetGame($gameId: String!) {
    games {
      game(id: $gameId) {
        ...GameFields
        players {
          edges {
            node {
              ...PlayerFields
            }
          }
          pageInfo {
            hasNextPage
            totalCount
          }
        }
        winners {
          ...PlayerFields
        }
        drawHistory {
          number
          round
          timestamp
          vrfProof
        }
      }
    }
  }
  ${PLAYER_FRAGMENT}
`;

export const LIST_GAMES = gql`
  ${GAME_FRAGMENT}
  query ListGames(
    $status: GameStatus
    $gameMode: GameMode
    $pagination: PaginationInput
    $sortBy: GameSortField
    $sortOrder: SortOrder
  ) {
    games {
      games(
        status: $status
        gameMode: $gameMode
        pagination: $pagination
        sortBy: $sortBy
        sortOrder: $sortOrder
      ) {
        edges {
          cursor
          node {
            ...GameFields
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
          totalCount
        }
      }
    }
  }
`;

export const MY_GAMES = gql`
  ${GAME_FRAGMENT}
  query MyGames(
    $userId: String!
    $status: GameStatus
    $pagination: PaginationInput
  ) {
    games {
      playerGames(
        userId: $userId
        status: $status
        pagination: $pagination
      ) {
        edges {
          cursor
          node {
            ...GameFields
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
          totalCount
        }
      }
    }
  }
`;

export const ACTIVE_GAMES = gql`
  ${GAME_FRAGMENT}
  ${PLAYER_FRAGMENT}
  query ActiveGames($chatId: String) {
    games {
      activeGames(chatId: $chatId) {
        ...GameFields
        players(pagination: { first: 5 }) {
          edges {
            node {
              ...PlayerFields
            }
          }
          pageInfo {
            totalCount
          }
        }
      }
    }
  }
`;

// Mutations
export const CREATE_GAME = gql`
  ${GAME_FRAGMENT}
  mutation CreateGame($input: CreateGameInput!) {
    games {
      createGame(input: $input) {
        ...GameFields
      }
    }
  }
`;

export const JOIN_GAME = gql`
  ${PLAYER_FRAGMENT}
  mutation JoinGame($input: JoinGameInput!) {
    games {
      joinGame(input: $input) {
        ...PlayerFields
      }
    }
  }
`;

export const SELECT_NUMBER = gql`
  ${PLAYER_FRAGMENT}
  mutation SelectNumber($input: SelectNumberInput!) {
    games {
      selectNumber(input: $input) {
        ...PlayerFields
      }
    }
  }
`;

export const START_GAME = gql`
  ${GAME_FRAGMENT}
  mutation StartGame($gameId: String!) {
    games {
      startGame(gameId: $gameId) {
        ...GameFields
      }
    }
  }
`;

export const PAUSE_GAME = gql`
  ${GAME_FRAGMENT}
  mutation PauseGame($gameId: String!) {
    games {
      pauseGame(gameId: $gameId) {
        ...GameFields
      }
    }
  }
`;

export const RESUME_GAME = gql`
  ${GAME_FRAGMENT}
  mutation ResumeGame($gameId: String!) {
    games {
      resumeGame(gameId: $gameId) {
        ...GameFields
      }
    }
  }
`;

export const COMPLETE_GAME = gql`
  ${GAME_FRAGMENT}
  mutation CompleteGame($input: CompleteGameInput!) {
    games {
      completeGame(input: $input) {
        ...GameFields
      }
    }
  }
`;

export const CANCEL_GAME = gql`
  ${GAME_FRAGMENT}
  mutation CancelGame($gameId: String!) {
    games {
      cancelGame(gameId: $gameId) {
        ...GameFields
      }
    }
  }
`;