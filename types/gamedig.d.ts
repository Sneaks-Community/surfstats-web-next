declare module 'gamedig' {
  export interface GameDigOptions {
    type: string;
    host: string;
    port: number;
    maxAttempts?: number;
    socketTimeout?: number;
  }

  export interface GameDigPlayer {
    name: string;
    score?: number;
    time?: number;
    raw?: Record<string, unknown>;
  }

  export interface GameDigState {
    name: string;
    map: string;
    players: GameDigPlayer[];
    maxplayers: number;
    ping: number;
  }

  // Static methods only; never instantiated.
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  export class GameDig {
    static query(options: GameDigOptions): Promise<GameDigState>;
  }
}
