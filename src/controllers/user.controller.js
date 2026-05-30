import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {User} from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshTokens = async(userId) => {
    // Implementation for generating access and refresh tokens
    try {
        const user = await User.findById(userId);
        // Generate access token and refresh token using JWT or any other method
        const accessToken = await user.generateAccessToken();
        const refreshToken = await user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        return { accessToken, refreshToken };

    } catch (error) {
        console.error("Error generating tokens:", error);
        throw new ApiError(500, "Failed to generate generate access and refresh tokens");
    }
};  

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
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath = "";
    if(req.files && Array.isArray(req.files?.coverImage) && req.files?.coverImage.length > 0) {
        coverImageLocalPath = req.files?.coverImage[0]?.path;
    }

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

const loginUser = asyncHandler(async (req, res) => {
    //req.body should have data

    const { username, email, password } = req.body || {};
    
    // username or email 

    if(!username && !email) {
        throw new ApiError(400, "Username or email is required");
    }

    // find the user 

    const user = await User.findOne({
        $or: [
            { username: username?.toLowerCase() }, 
            { email }
        ]
    });

    if(!user) {
        throw new ApiError(404, "User not found");
    }

    // password should be correct

    const isPasswordValid = await user.isPasswordCorrect(password);

    if(!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials");
    }

    // access token and refresh token should be generated and sent to frontend in response.

    const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id);

    // send cookie with refresh token and access token in response body

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true,
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(new ApiResponse(200, "User logged in successfully", {
        accessToken,
        user: loggedInUser,
        refreshToken
    }));
});

const logoutUser = asyncHandler(async (req, res) => {
    // get user id from req.user
await User.findByIdAndUpdate(
    req.user._id, 
        { $unset: { 
            refreshToken: 1 // this removes the refreshToken field from the user document in the database, effectively logging the user out by invalidating their refresh token 
        } 
    }, 
    { 
        returnDocument: "after"
    }
);

const options = {
    httpOnly: true,
    secure: true
}

return res
.status(200)
.clearCookie("accessToken", options)
.clearCookie("refreshToken", options)
.json(new ApiResponse(200, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies?.refreshToken || req.body.refreshToken || req.headers.authorization?.replace("Bearer ", "") || null;

    if(!incomingRefreshToken) {
        throw new ApiError(400, "Refresh token is required");
    }

    try {
    const decodedToken = jwt.verify(
            incomingRefreshToken, 
            process.env.REFRESH_TOKEN_SECRET);
        
        const user = await User.findById(decodedToken?._id);

    if(!user || user?.refreshToken !== incomingRefreshToken) {
        throw new ApiError(401, "Invalid refresh token");
    }

    const options = {
        httpOnly: true,
        secure: true
    };

    const {accessToken,  newRefreshToken} = await generateAccessAndRefreshTokens(user._id);

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", newRefreshToken, options)
    .json(new ApiResponse(200, "Access token refreshed successfully", {
        accessToken,
        refreshToken : newRefreshToken
    }));

    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
    }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    const user = await User.findById(req.user._id);
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

    if(!isPasswordCorrect) {
        throw new ApiError(401, "Old password is incorrect");
    }

    user.password = newPassword;
    await user.save({
        validateBeforeSave: false
    });
    return res.status(200).json(new ApiResponse(200, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res
    .status(200)
    .json(new ApiResponse(200, "Current user fetched successfully", req.user));
});

const updateAccountDetails = asyncHandler(async (req, res) => {

    const { fullName, email } = req.body || {};
    
    if(!(fullName || email)) {
        throw new ApiError(400, "At least one field is required to update");
    }

    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        { $set: {
                    fullName: fullName,
                    email: email
                } 
        },
        { returnDocument: "after" }
    ).select("-password");

    return res.status(200).json(new ApiResponse(200, "Account details updated successfully", updatedUser));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;
    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar image is required");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    //TODO: delete previous avatar from cloudinary to save storage and cost

    if(!avatar) {
        throw new ApiError(500, "Failed to upload avatar image");
    }
    
    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: { avatar: avatar.url } },
        { returnDocument: "after" }
    ).select("-password");

    return res.status(200).json(new ApiResponse(200, "User avatar updated successfully", user));

});

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;
    if(!coverImageLocalPath) {
        throw new ApiError(400, "Cover image is required");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if(!coverImage) {
        throw new ApiError(500, "Failed to upload cover image");
    }
    
    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: { coverImage: coverImage.url } },
        { returnDocument: "after" }
    ).select("-password");

    return res.status(200).json(new ApiResponse(200, "User cover image updated successfully", user));
    
});


const getUserChannelProfile = asyncHandler(async (req, res) => {
    const {username} = req.params || {};
    if(!username?.trim()) {
        throw new ApiError(400, "Username is missing");
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username.toLowerCase()
            },
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            },
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            },
        },
        {
            $addFields: {
                subscribersCount: { $size: "$subscribers" },
                channelsSubscribedToCount: { $size: "$subscribedTo" },
                isSubscribed: {
                    $cond: {
                        if: {$in : [req.user._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                email: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1
            }
        }
    ]);

    console.log("Channel profile data:", channel);

    if(!channel || channel.length === 0) {
        throw new ApiError(404, "Channel not found");
    }

    return res
    .status(200)
    .json(new ApiResponse(200, "Channel profile fetched successfully", channel[0]));
});


const getUserWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        },
    ]);

    return res
    .status(200)
    .json(new ApiResponse(200, "User watch history fetched successfully", user[0]?.watchHistory || []));

});


export { registerUser, loginUser, logoutUser, refreshAccessToken, changeCurrentPassword, getCurrentUser, updateAccountDetails, updateUserAvatar, updateUserCoverImage, getUserChannelProfile, getUserWatchHistory };