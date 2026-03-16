// src/utils/restaurantTime.js

export function isRestaurantOpenNow(openingTime, closingTime) {
  // ✅ Handle null / empty / undefined
  if (
    !openingTime ||
    !closingTime ||
    typeof openingTime !== 'string' ||
    typeof closingTime !== 'string'
  ) {
    return true; // fallback: treat as open
  }

  const now = new Date();

  const [openH, openM] = openingTime.split(':').map(Number);
  const [closeH, closeM] = closingTime.split(':').map(Number);

  const open = new Date(now);
  open.setHours(openH, openM, 0, 0);

  const close = new Date(now);
  close.setHours(closeH, closeM, 0, 0);

  return now >= open && now <= close;
}
