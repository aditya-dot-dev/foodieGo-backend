import { cloudinary } from '../config/cloudinary.js';

/**
 * Extracts public ID from a Cloudinary URL and deletes the image
 * @param {string} imageUrl - The full Cloudinary URL
 * @returns {Promise<void>}
 */
export const deleteImageFromCloudinary = async (imageUrl) => {
  if (!imageUrl || !imageUrl.includes('cloudinary.com')) {
    return;
  }

  try {
    // URL format: https://res.cloudinary.com/cloud_name/image/upload/v1234567/swiggy-clone/profiles/public_id.jpg
    const parts = imageUrl.split('/');
    const lastPart = parts[parts.length - 1]; // public_id.jpg
    const folderParts = parts.slice(parts.indexOf('swiggy-clone')); // ['swiggy-clone', 'profiles', 'public_id.jpg']
    
    // Join folder parts and remove extension
    const publicIdWithExtension = folderParts.join('/');
    const publicId = publicIdWithExtension.split('.')[0];

    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting image from Cloudinary:', error);
  }
};
