import {v2 as cloudinary} from "cloudinary";
import fs from "fs";

cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadOnCloudinary = async (localFilePath) => {
    try {
        if(!localFilePath) return null
        //upload image to cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, { resource_type: "auto" }, (error, result) => {
            if(error) {
                console.error("Cloudinary upload error:", error);
                throw error;
            }
        });
        fs.unlinkSync(localFilePath); // delete the local file after successful upload
        return response;
    }
    catch (error) {
        fs.unlink(localFilePath); // delete the local file after upload attempt as the upload failed
        return null;
    }
}

export {uploadOnCloudinary};