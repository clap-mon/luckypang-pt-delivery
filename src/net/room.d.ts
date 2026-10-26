export interface StudentInfo {
  peerId: string;
  conn: any;
  nickname: string;
  joinedAt: number;
  lastProgress?: any;
}

export interface HostRoomOptions {
  gameName?: string;
  onReady?: (code: string, peerId: string) => void;
  onStudentJoin?: (student: StudentInfo) => any;
  onStudentLeave?: (peerId: string) => void;
  onProgress?: (peerId: string, data: any) => void;
  onMessage?: (peerId: string, payload: { type: string; data: any }) => void;
  onError?: (err: any) => void;
}

export class HostRoom {
  code: string;
  peerId: string;
  peer: any;
  students: Map<string, StudentInfo>;
  constructor(options?: HostRoomOptions);
  init(preferredCode?: string | null): Promise<void>;
  broadcast(type: string, data: any): void;
  sendTo(peerId: string, type: string, data: any): void;
  kick(peerId: string, reason?: string): void;
  start(passageData: any, countdown?: number): void;
  sendBoard(rankingData: any): void;
  end(finalResults: any): void;
  sendEvent(eventName: string, payload: any): void;
  updateCallbacks(newCallbacks?: Partial<HostRoomOptions>): void;
  destroy(): void;
}

export interface GuestRoomOptions {
  gameName?: string;
  code: string;
  nickname: string;
  onJoined?: (data: any) => void;
  onFail?: (err: any) => void;
  onHostLost?: (err?: any) => void;
  onStart?: (data: any) => void;
  onBoard?: (data: any) => void;
  onEnd?: (data: any) => void;
  onKick?: (reason: string) => void;
  onMessage?: (payload: { type: string; data: any }) => void;
}

export class GuestRoom {
  code: string;
  nickname: string;
  peer: any;
  conn: any;
  restoreData?: any;
  isConnected: boolean;
  isReconnecting: boolean;
  hasJoined: boolean;
  hasFailed: boolean;
  isHostEnded: boolean;
  constructor(options: GuestRoomOptions);
  connect(): Promise<void>;
  updateCallbacks(newCallbacks?: Partial<GuestRoomOptions>): void;
  sendProgress(progressData: any): void;
  sendEvent(eventName: string, payload: any): void;
  destroy(): void;
}

export function getActiveHostRoom(): HostRoom | null;
export function setActiveHostRoom(room: HostRoom | null): void;
export function getActiveGuestRoom(): GuestRoom | null;
export function setActiveGuestRoom(room: GuestRoom | null): void;

export function generateRoomCode(): string;
export const MAX_ROOM_CAPACITY: number;
export const CONNECT_TIMEOUT_MS: number;
export const RECONNECT_INTERVAL_MS: number;
export const RECONNECT_SINGLE_TIMEOUT_MS: number;
export const MAX_RECONNECT_ATTEMPTS: number;
export const MAX_CODE_RETRY: number;
