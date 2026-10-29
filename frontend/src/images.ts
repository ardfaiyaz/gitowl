// Image types the image diff can show (server: image_pair).
export const isImage = (file: string) => /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(file);
