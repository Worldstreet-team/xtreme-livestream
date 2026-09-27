/**
 * The cover drawing's version, on its own so client code can build cover
 * URLs without pulling the drawing (and its outlines) into the bundle.
 * Bump it whenever lib/cover-art draws differently: covers are cached
 * immutably, and the version in the URL is what refreshes them.
 */
export const COVER_VERSION = 1;
