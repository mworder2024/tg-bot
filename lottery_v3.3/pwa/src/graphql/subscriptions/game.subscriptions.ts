import { gql } from '@apollo/client';

// Import fragments
import { GAME_FRAGMENT, PLAYER_FRAGMENT } from '../queries/game.queries';
import { USER_FRAGMENT } from '../queries/auth.queries';

// Game event subscription
export const GAME_EVENTS = gql`
  ${GAME_FRAGMENT}
  ${PLAYER_FRAGMENT}
  subscription GameEvents($filter: GameSubscriptionFilter) {
    gameEvents(filter: $filter) {
      type
      game {
        ...GameFields
      }
      player {
        ...PlayerFields
      }
      data
      timestamp
    }
  }
`;

// Game updates subscription
export const GAME_UPDATES = gql`
  ${GAME_FRAGMENT}
  subscription GameUpdates($gameId: String!) {
    gameUpdates(gameId: $gameId) {
      ...GameFields
    }
  }
`;

// Player updates subscription
export const PLAYER_UPDATES = gql`
  ${PLAYER_FRAGMENT}
  subscription PlayerUpdates($gameId: String!, $playerId: String!) {
    playerUpdates(gameId: $gameId, playerId: $playerId) {
      ...PlayerFields
    }
  }
`;

// Leaderboard updates subscription
export const LEADERBOARD_UPDATES = gql`
  ${USER_FRAGMENT}
  subscription LeaderboardUpdates($gameMode: GameMode!, $timeframe: LeaderboardTimeframe!) {
    leaderboardUpdates(gameMode: $gameMode, timeframe: $timeframe) {
      leaderboard {
        rank
        user {
          ...UserFields
        }
        score
        gamesWon
        winRate
        change
      }
      gameMode
      timeframe
      timestamp
    }
  }
`;

// User notifications subscription
export const USER_NOTIFICATIONS = gql`
  subscription UserNotifications($userId: String!) {
    userNotifications(userId: $userId) {
      id
      type
      title
      message
      data
      read
      timestamp
    }
  }
`;

// Game invites subscription
export const GAME_INVITES = gql`
  ${GAME_FRAGMENT}
  ${USER_FRAGMENT}
  subscription GameInvites($userId: String!) {
    userGameInvites(userId: $userId) {
      id
      game {
        ...GameFields
      }
      invitedBy {
        ...UserFields
      }
      expiresAt
    }
  }
`;