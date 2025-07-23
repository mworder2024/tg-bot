export type TelegramLottery = {
  "version": "0.1.0",
  "name": "telegram_lottery",
  "instructions": [
    {
      "name": "initialize",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "treasuryState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "treasuryAuthority",
          "type": "publicKey"
        },
        {
          "name": "feePercentage",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createGame",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryState",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vrfOracle",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "entryFee",
          "type": "u64"
        },
        {
          "name": "maxPlayers",
          "type": "u8"
        },
        {
          "name": "winnerCount",
          "type": "u8"
        },
        {
          "name": "paymentDeadlineMinutes",
          "type": "u16"
        }
      ]
    },
    {
      "name": "joinGame",
      "accounts": [
        {
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "telegramId",
          "type": "string"
        }
      ]
    },
    {
      "name": "selectNumber",
      "accounts": [
        {
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "number",
          "type": "u8"
        }
      ]
    },
    {
      "name": "submitVrf",
      "accounts": [
        {
          "name": "vrfOracle",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vrfResult",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "round",
          "type": "u8"
        },
        {
          "name": "randomValue",
          "type": {
            "array": ["u8", 32]
          }
        },
        {
          "name": "proof",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "processElimination",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vrfResult",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "round",
          "type": "u8"
        }
      ]
    },
    {
      "name": "completeGame",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        }
      ]
    },
    {
      "name": "claimPrize",
      "accounts": [
        {
          "name": "winner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "winnerTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        }
      ]
    },
    {
      "name": "requestRefund",
      "accounts": [
        {
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        }
      ]
    },
    {
      "name": "cancelGame",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "withdrawTreasury",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "treasuryState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "destinationTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": {
            "option": "u64"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gameState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "string"
          },
          {
            "name": "authority",
            "type": "publicKey"
          },
          {
            "name": "treasury",
            "type": "publicKey"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "maxPlayers",
            "type": "u8"
          },
          {
            "name": "winnerCount",
            "type": "u8"
          },
          {
            "name": "state",
            "type": {
              "defined": "GameStatus"
            }
          },
          {
            "name": "prizePool",
            "type": "u64"
          },
          {
            "name": "treasuryFee",
            "type": "u64"
          },
          {
            "name": "numberRange",
            "type": {
              "defined": "NumberRange"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "startedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "completedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "paymentDeadline",
            "type": "i64"
          },
          {
            "name": "currentRound",
            "type": "u8"
          },
          {
            "name": "drawnNumbers",
            "type": {
              "vec": "u8"
            }
          },
          {
            "name": "tokenMint",
            "type": "publicKey"
          },
          {
            "name": "escrowAccount",
            "type": "publicKey"
          },
          {
            "name": "vrfOracle",
            "type": "publicKey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerList",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "string"
          },
          {
            "name": "players",
            "type": {
              "vec": {
                "defined": "Player"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasuryState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "publicKey"
          },
          {
            "name": "totalCollected",
            "type": "u64"
          },
          {
            "name": "totalDistributed",
            "type": "u64"
          },
          {
            "name": "pendingWithdrawal",
            "type": "u64"
          },
          {
            "name": "feePercentage",
            "type": "u8"
          },
          {
            "name": "treasuryTokenAccount",
            "type": "publicKey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vrfResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "string"
          },
          {
            "name": "round",
            "type": "u8"
          },
          {
            "name": "randomValue",
            "type": {
              "array": ["u8", 32]
            }
          },
          {
            "name": "proof",
            "type": "bytes"
          },
          {
            "name": "drawnNumber",
            "type": "u8"
          },
          {
            "name": "used",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "Player",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "publicKey"
          },
          {
            "name": "telegramId",
            "type": "string"
          },
          {
            "name": "selectedNumber",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "eliminatedRound",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "isWinner",
            "type": "bool"
          },
          {
            "name": "prizeClaimed",
            "type": "bool"
          },
          {
            "name": "prizeAmount",
            "type": "u64"
          },
          {
            "name": "joinedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "NumberRange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "min",
            "type": "u8"
          },
          {
            "name": "max",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "GameStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Created"
          },
          {
            "name": "Joining"
          },
          {
            "name": "NumberSelection"
          },
          {
            "name": "Playing"
          },
          {
            "name": "Distributing"
          },
          {
            "name": "Completed"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "GameCreatedEvent",
      "fields": [
        {
          "name": "gameId",
          "type": "string",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "entryFee",
          "type": "u64",
          "index": false
        },
        {
          "name": "maxPlayers",
          "type": "u8",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "PlayerJoinedEvent",
      "fields": [
        {
          "name": "gameId",
          "type": "string",
          "index": false
        },
        {
          "name": "player",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "telegramId",
          "type": "string",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "GameCompletedEvent",
      "fields": [
        {
          "name": "gameId",
          "type": "string",
          "index": false
        },
        {
          "name": "winners",
          "type": {
            "vec": "publicKey"
          },
          "index": false
        },
        {
          "name": "prizePool",
          "type": "u64",
          "index": false
        },
        {
          "name": "treasuryFee",
          "type": "u64",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "GameIdTooLong",
      "msg": "Game ID is too long"
    },
    {
      "code": 6001,
      "name": "InvalidEntryFee",
      "msg": "Invalid entry fee"
    },
    {
      "code": 6002,
      "name": "InvalidWinnerCount",
      "msg": "Invalid winner count"
    },
    {
      "code": 6003,
      "name": "InvalidGameState",
      "msg": "Invalid game state for this operation"
    },
    {
      "code": 6004,
      "name": "PaymentDeadlineExpired",
      "msg": "Payment deadline has expired"
    },
    {
      "code": 6005,
      "name": "GameFull",
      "msg": "Game is full"
    },
    {
      "code": 6006,
      "name": "PlayerAlreadyJoined",
      "msg": "Player has already joined this game"
    },
    {
      "code": 6007,
      "name": "ArithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6008,
      "name": "Unauthorized",
      "msg": "Unauthorized"
    }
  ]
};

export const IDL: TelegramLottery = {
  "version": "0.1.0",
  "name": "telegram_lottery",
  "instructions": [
    {
      "name": "initialize",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "treasuryState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "treasuryAuthority",
          "type": "publicKey"
        },
        {
          "name": "feePercentage",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createGame",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryState",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vrfOracle",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "entryFee",
          "type": "u64"
        },
        {
          "name": "maxPlayers",
          "type": "u8"
        },
        {
          "name": "winnerCount",
          "type": "u8"
        },
        {
          "name": "paymentDeadlineMinutes",
          "type": "u16"
        }
      ]
    },
    {
      "name": "joinGame",
      "accounts": [
        {
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "telegramId",
          "type": "string"
        }
      ]
    },
    {
      "name": "selectNumber",
      "accounts": [
        {
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "number",
          "type": "u8"
        }
      ]
    },
    {
      "name": "submitVrf",
      "accounts": [
        {
          "name": "vrfOracle",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vrfResult",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "round",
          "type": "u8"
        },
        {
          "name": "randomValue",
          "type": {
            "array": ["u8", 32]
          }
        },
        {
          "name": "proof",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "processElimination",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vrfResult",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "round",
          "type": "u8"
        }
      ]
    },
    {
      "name": "completeGame",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        }
      ]
    },
    {
      "name": "claimPrize",
      "accounts": [
        {
          "name": "winner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "winnerTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        }
      ]
    },
    {
      "name": "requestRefund",
      "accounts": [
        {
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        }
      ]
    },
    {
      "name": "cancelGame",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "gameState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "playerList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "string"
        },
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "withdrawTreasury",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "treasuryState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "destinationTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": {
            "option": "u64"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gameState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "string"
          },
          {
            "name": "authority",
            "type": "publicKey"
          },
          {
            "name": "treasury",
            "type": "publicKey"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "maxPlayers",
            "type": "u8"
          },
          {
            "name": "winnerCount",
            "type": "u8"
          },
          {
            "name": "state",
            "type": {
              "defined": "GameStatus"
            }
          },
          {
            "name": "prizePool",
            "type": "u64"
          },
          {
            "name": "treasuryFee",
            "type": "u64"
          },
          {
            "name": "numberRange",
            "type": {
              "defined": "NumberRange"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "startedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "completedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "paymentDeadline",
            "type": "i64"
          },
          {
            "name": "currentRound",
            "type": "u8"
          },
          {
            "name": "drawnNumbers",
            "type": {
              "vec": "u8"
            }
          },
          {
            "name": "tokenMint",
            "type": "publicKey"
          },
          {
            "name": "escrowAccount",
            "type": "publicKey"
          },
          {
            "name": "vrfOracle",
            "type": "publicKey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerList",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "string"
          },
          {
            "name": "players",
            "type": {
              "vec": {
                "defined": "Player"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasuryState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "publicKey"
          },
          {
            "name": "totalCollected",
            "type": "u64"
          },
          {
            "name": "totalDistributed",
            "type": "u64"
          },
          {
            "name": "pendingWithdrawal",
            "type": "u64"
          },
          {
            "name": "feePercentage",
            "type": "u8"
          },
          {
            "name": "treasuryTokenAccount",
            "type": "publicKey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vrfResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "string"
          },
          {
            "name": "round",
            "type": "u8"
          },
          {
            "name": "randomValue",
            "type": {
              "array": ["u8", 32]
            }
          },
          {
            "name": "proof",
            "type": "bytes"
          },
          {
            "name": "drawnNumber",
            "type": "u8"
          },
          {
            "name": "used",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "Player",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "publicKey"
          },
          {
            "name": "telegramId",
            "type": "string"
          },
          {
            "name": "selectedNumber",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "eliminatedRound",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "isWinner",
            "type": "bool"
          },
          {
            "name": "prizeClaimed",
            "type": "bool"
          },
          {
            "name": "prizeAmount",
            "type": "u64"
          },
          {
            "name": "joinedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "NumberRange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "min",
            "type": "u8"
          },
          {
            "name": "max",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "GameStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Created"
          },
          {
            "name": "Joining"
          },
          {
            "name": "NumberSelection"
          },
          {
            "name": "Playing"
          },
          {
            "name": "Distributing"
          },
          {
            "name": "Completed"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "GameCreatedEvent",
      "fields": [
        {
          "name": "gameId",
          "type": "string",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "entryFee",
          "type": "u64",
          "index": false
        },
        {
          "name": "maxPlayers",
          "type": "u8",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "PlayerJoinedEvent",
      "fields": [
        {
          "name": "gameId",
          "type": "string",
          "index": false
        },
        {
          "name": "player",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "telegramId",
          "type": "string",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "GameCompletedEvent",
      "fields": [
        {
          "name": "gameId",
          "type": "string",
          "index": false
        },
        {
          "name": "winners",
          "type": {
            "vec": "publicKey"
          },
          "index": false
        },
        {
          "name": "prizePool",
          "type": "u64",
          "index": false
        },
        {
          "name": "treasuryFee",
          "type": "u64",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "GameIdTooLong",
      "msg": "Game ID is too long"
    },
    {
      "code": 6001,
      "name": "InvalidEntryFee",
      "msg": "Invalid entry fee"
    },
    {
      "code": 6002,
      "name": "InvalidWinnerCount",
      "msg": "Invalid winner count"
    },
    {
      "code": 6003,
      "name": "InvalidGameState",
      "msg": "Invalid game state for this operation"
    },
    {
      "code": 6004,
      "name": "PaymentDeadlineExpired",
      "msg": "Payment deadline has expired"
    },
    {
      "code": 6005,
      "name": "GameFull",
      "msg": "Game is full"
    },
    {
      "code": 6006,
      "name": "PlayerAlreadyJoined",
      "msg": "Player has already joined this game"
    },
    {
      "code": 6007,
      "name": "ArithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6008,
      "name": "Unauthorized",
      "msg": "Unauthorized"
    }
  ]
};