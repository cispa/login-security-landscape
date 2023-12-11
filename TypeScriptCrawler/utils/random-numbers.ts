/**
 * Returns a random int value using Math.random() bounded by max, which is floored
 * 
 * @param max Maximum random int value
 * @returns Random value
 */
export const getRandomInt = (max: number) => {
    return Math.floor(Math.random() * max);
}