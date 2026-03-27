/**
 * Lazy loader for Chart.js (chart.umd.js).
 * Loads the charting library only when the chart view is activated,
 * saving ~205 KB on initial page load.
 */

let _chartLoaded = false;

/**
 * Loads Chart.js dynamically if not already loaded.
 * @returns {Promise<void>}
 */
export function loadChart() {
  if (_chartLoaded || typeof window.Chart !== 'undefined') {
    _chartLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/chart.umd.js';
    script.onload = () => {
      _chartLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load chart.umd.js'));
    document.head.appendChild(script);
  });
}

/**
 * Creates a new Chart instance after ensuring the library is loaded.
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {object} config - Chart.js configuration object
 * @returns {Promise<Chart>}
 */
export function createChart(canvas, config) {
  return loadChart().then(() => new window.Chart(canvas, config));
}
