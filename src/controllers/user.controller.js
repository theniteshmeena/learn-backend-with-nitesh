import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {User} from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import {ApiResponse} from "../utils/ApiResponse.js";

const registerUser = asyncHandler(async (req, res) => {

    // Get user details from frontend
    
    const { username, email, fullName, password } = req.body || {};
    console.log("Received user details:", { username, email, fullName, password: password ? "Provided" : "Not Provided" });
    
    // validate user details - not empty

    if([username, email, fullName, password].some((field)=> field?.trim==="")) {
        throw new ApiError(400, "All fields are required");
    }

    // check if user already exists in db - Username & Email should be unique

    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    });
    if(existedUser) {
        throw new ApiError(409, "Username or email already exists");
    }
    //check for images and avatar and cover image are required

    const avatarLocalPath =  req.files?.avatar[0]?.path;
    const coverImageLocalPath = req.files?.coverImage[0]?.path;

    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar is required");
    }

    //upload images to cloudinary and get the url
    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if(!avatar) {
        throw new ApiError(400, "Avatar is required");
    }

    //create user object and create entry in db

    const user = await User.create({
        fullName,
        username: username.toLowerCase(),
        email,
        password,
        avatar: avatar.url,
        coverimage: coverImage?.url || "",
    })

    //remove password and refresh token from the response

    const createdUser = await User.findById(user._id).select("-password -refreshToken");
    //check for user creation success
    if(!createdUser) {
        throw new ApiError(500, "Something went wrong while creating user");
    }

    //return response to frontend
    return res.status(201).json(new ApiResponse(200, "User registered successfully", createdUser));
    
});

export { registerUser };