const { v2: cloudinary } = require('cloudinary');

const requiredEnv = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
];

function configureCloudinary() {
    const missingEnv = requiredEnv.filter((key) => !process.env[key]);

    if (missingEnv.length > 0) {
        throw new Error(`Missing Cloudinary environment variables: ${missingEnv.join(', ')}`);
    }

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true
    });
}

function uploadVideo(buffer, originalName) {
    configureCloudinary();

    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: 'video',
                folder: 'tiktok-videos',
                public_id: originalName.replace(/\.[^/.]+$/, ''),
                overwrite: false
            },
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(result);
            }
        );

        uploadStream.end(buffer);
    });
}

module.exports = { uploadVideo };
