export interface PendingUser {
  userId: number;
  chatId: number;
  correctAnswer: string;
  joinedAt: number;
  messageId: number;
}

// key: chatId:userId
export const pendingUsers: Map<string, PendingUser> = new Map();
