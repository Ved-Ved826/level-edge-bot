export const calculateLevel = (xp) => {
    return Math.floor(0.1 * Math.sqrt(xp));
};
export const calculateXpForLevel = (level) => {
    const base = level / 0.1;
    return Math.round(base * base);
};
export const getNextLevelXp = (currentLevel) => {
    const nextLevel = currentLevel + 1;
    return calculateXpForLevel(nextLevel);
};
export const getXpProgress = (xp) => {
    const level = calculateLevel(xp);
    const currentLevelXp = calculateXpForLevel(level);
    const nextLevelXp = calculateXpForLevel(level + 1);
    const progress = ((xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100;
    return { level, currentLevelXp, nextLevelXp, progress };
};
