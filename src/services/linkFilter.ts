const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+/i;

export function containsLink(text: string): boolean {
  return URL_REGEX.test(text);
}
