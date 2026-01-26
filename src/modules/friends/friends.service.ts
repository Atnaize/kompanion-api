import { prisma } from '@shared/utils/index.js';

interface KompanionFriend {
  id: number;
  stravaId: number;
  firstname: string;
  lastname: string;
  profile: string;
  profileMedium: string;
}

/**
 * Normalizes a string for search by:
 * - Removing diacritics/accents (é→e, ü→u, ñ→n)
 * - Converting ligatures (æ→ae, œ→oe, ß→ss)
 * - Handling special characters (ø→o, đ→d, ł→l)
 * - Converting to lowercase
 * - Trimming whitespace
 *
 * Examples:
 *   "Mégane" → "megane"
 *   "Æon" → "aeon"
 *   "Müller" → "muller"
 *   "Søren" → "soren"
 *   "Groß" → "gross"
 */
function normalizeForSearch(str: string): string {
  return (
    str
      // Handle common ligatures BEFORE NFD normalization
      .replace(/æ/gi, 'ae')
      .replace(/œ/gi, 'oe')
      .replace(/ß/g, 'ss')
      .replace(/ø/gi, 'o')
      .replace(/đ/gi, 'd')
      .replace(/ł/gi, 'l')
      .replace(/ħ/gi, 'h')
      .replace(/ŧ/gi, 't')
      // Normalize to NFD (decomposed form) and remove combining diacritical marks
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Convert to lowercase
      .toLowerCase()
      // Remove extra whitespace
      .trim()
  );
}

export class FriendsService {
  /**
   * Search Kompanion users by name (accent and special character insensitive)
   * Used for inviting users to challenges
   *
   * Features:
   * - Accent insensitive: "meg" finds "Mégane"
   * - Ligature aware: "ae" finds "Ærodynamic"
   * - Special char aware: "o" finds "Søren"
   */
  async searchUsers(query: string, currentUserId: number): Promise<KompanionFriend[]> {
    if (query.length < 2) {
      throw new Error('Search query must be at least 2 characters');
    }

    const normalizedQuery = normalizeForSearch(query);

    // Fetch users and filter with normalized comparison
    // This approach works with any database without requiring extensions
    const users = await prisma.user.findMany({
      where: {
        id: { not: currentUserId },
      },
      select: {
        id: true,
        stravaId: true,
        firstname: true,
        lastname: true,
        profile: true,
        profileMedium: true,
      },
    });

    const filteredUsers = users.filter((user) => {
      const normalizedFirstname = normalizeForSearch(user.firstname);
      const normalizedLastname = normalizeForSearch(user.lastname);

      return (
        normalizedFirstname.includes(normalizedQuery) ||
        normalizedLastname.includes(normalizedQuery)
      );
    });

    return filteredUsers.slice(0, 20);
  }
}
