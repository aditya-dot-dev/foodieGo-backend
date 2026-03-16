/*
  # Add user profile fields and location coordinates

  1. Changes to `users` table:
    - Make `phone` optional (nullable)
    - Add `full_name` (optional, for complete user names)
    - Add `profile_image` (optional, stores image URL)
    - Add `lat` and `lng` (optional, for location-based services)

  2. Changes to `restaurants` table:
    - Add `lat` and `lng` (optional, for maps integration)

  3. Notes:
    - phone field is changed from required to optional for flexibility
    - All new fields are nullable to maintain backward compatibility
    - location fields (lat/lng) support map-based features
*/

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "full_name" TEXT,
ADD COLUMN "profile_image" TEXT,
ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lng" DOUBLE PRECISION;

ALTER TABLE "users"
ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "restaurants"
ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lng" DOUBLE PRECISION;
