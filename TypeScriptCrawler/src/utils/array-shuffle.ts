
/**
 * Method to shuffle array. Taken from https://stackoverflow.com/a/6274381
 * @param a Array to be shuffled
 * @returns 
 */
const shuffle = (a: unknown[]) => {
    let j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}

export { shuffle }