const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+/gi;

export function containsLink(text: string): boolean {
  return URL_REGEX.test(text);
}
