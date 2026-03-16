import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folder = 'swiggy-clone';
    
    // Determine folder based on route or fieldname
    if (req.baseUrl.includes('profile')) {
      folder = 'swiggy-clone/profiles';
    } else if (req.baseUrl.includes('restaurants')) {
      if (req.url.includes('menu')) {
        folder = 'swiggy-clone/menu';
      } else {
        folder = 'swiggy-clone/restaurants';
      }
    }

    return {
      folder: folder,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
      public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
    };
  },
});

export { cloudinary, storage };
