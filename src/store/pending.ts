export interface PendingUser {
  userId: number;
  chatId: number;
  correctAnswer: string;
  joinedAt: number;
  messageId: number;
  timer?: ReturnType<typeof setTimeout>;
}

// key: chatId:userId
export const pendingUsers: Map<string, PendingUser> = new Map();
