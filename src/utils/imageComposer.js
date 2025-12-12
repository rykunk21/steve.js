const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * ImageComposer - Creates composite images from team logos
 */
class ImageComposer {
  constructor() {
    this.cacheDir = path.join(process.cwd(), 'data', 'image-cache');
    this.ensureCacheDir();
  }

  /**
   * Ensure cache directory exists
   */
  async ensureCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create image cache directory', { error: error.message });
    }
  }

  /**
   * Create a side-by-side composite image of two team logos
   * @param {string} logo1Url - URL of first team logo
   * @param {string} logo2Url - URL of second team logo
   * @param {string} team1Abbrev - First team abbreviation
   * @param {string} team2Abbrev - Second team abbreviation
   * @returns {Promise<Buffer>} - PNG image buffer
   */
  async createSideBySideLogos(logo1Url, logo2Url, team1Abbrev, team2Abbrev) {
    try {
      // Check cache first
      const cacheKey = `${team1Abbrev}_vs_${team2Abbrev}.png`;
      const cachePath = path.join(this.cacheDir, cacheKey);
      
      try {
        const cached = await fs.readFile(cachePath);
        logger.debug('Using cached composite image', { cacheKey });
        return cached;
      } catch {
        // Cache miss, create new image
      }

      // Download both logos
      const [logo1, logo2] = await Promise.all([
        this.downloadImage(logo1Url),
        this.downloadImage(logo2Url)
      ]);

      // Create canvas (wider than tall: 400x150)
      const canvas = createCanvas(400, 150);
      const ctx = canvas.getContext('2d');

      // Fill background with dark color
      ctx.fillStyle = '#2C2F33';
      ctx.fillRect(0, 0, 400, 150);

      // Load images
      const img1 = await loadImage(logo1);
      const img2 = await loadImage(logo2);

      // Calculate logo size (square, centered vertically)
      const logoSize = 120;
      const yOffset = (150 - logoSize) / 2;

      // Draw first logo (left side)
      const x1 = 40;
      ctx.drawImage(img1, x1, yOffset, logoSize, logoSize);

      // Draw "VS" text in the middle
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VS', 200, 75);

      // Draw second logo (right side)
      const x2 = 240;
      ctx.drawImage(img2, x2, yOffset, logoSize, logoSize);

      // Convert to buffer
      const buffer = canvas.toBuffer('image/png');

      // Cache the result
      await fs.writeFile(cachePath, buffer);
      logger.debug('Created and cached composite image', { cacheKey });

      return buffer;

    } catch (error) {
      logger.error('Failed to create composite image', {
        error: error.message,
        team1: team1Abbrev,
        team2: team2Abbrev
      });
      return null;
    }
  }

  /**
   * Download an image from URL
   * @param {string} url - Image URL
   * @returns {Promise<Buffer>} - Image buffer
   */
  async downloadImage(url) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 5000
    });
    return Buffer.from(response.data);
  }

  /**
   * Clear image cache
   */
  async clearCache() {
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map(file => fs.unlink(path.join(this.cacheDir, file)))
      );
      logger.info('Cleared image cache', { filesDeleted: files.length });
    } catch (error) {
      logger.error('Failed to clear image cache', { error: error.message });
    }
  }
}

module.exports = ImageComposer;
