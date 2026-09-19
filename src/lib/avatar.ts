/** Side of the square photo that gets uploaded, px. Plenty for the largest place it is shown. */
export const AVATAR_SIZE = 320

/**
 * The middle square of an image, scaled to AVATAR_SIZE and re-encoded as JPEG: a phone photo of
 * several megabytes becomes a few tens of kilobytes, and the upload never carries its metadata.
 * Rejects when the browser cannot read the file as an image.
 */
export async function squareAvatar(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2d canvas')
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
        'image/jpeg',
        0.86,
      ),
    )
  } finally {
    bitmap.close()
  }
}
