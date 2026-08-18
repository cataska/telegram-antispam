import { Api } from 'grammy';

// 限制到期後 Telegram 才會把使用者恢復成一般 member。
// 少於 30 秒會被視為「永久限制」，故取略高於門檻的值。
const LIFT_DELAY_SECONDS = 35;

const MUTED: Parameters<Api['restrictChatMember']>[2] = {
  can_send_messages: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
};

// 驗證期間完全靜音
export async function muteForVerification(api: Api, chatId: number, userId: number) {
  await api.restrictChatMember(chatId, userId, MUTED);
}

// 解除驗證期限制。
// 不能只把權限設回群組預設值就收工：Telegram 的 restricted 使用者不受後續群組
// 預設權限變更影響，那樣會讓已驗證的成員永遠停在 restricted，管理員之後調整
// 群組權限也套不到他們身上。改用短期限制，到期後由 Telegram 自動恢復成 member。
export async function liftRestrictions(api: Api, chatId: number, userId: number) {
  const chat = await api.getChat(chatId);
  const permissions = chat.permissions ?? {
    can_send_messages: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
  };
  await api.restrictChatMember(chatId, userId, permissions, {
    until_date: Math.floor(Date.now() / 1000) + LIFT_DELAY_SECONDS,
  });
}
