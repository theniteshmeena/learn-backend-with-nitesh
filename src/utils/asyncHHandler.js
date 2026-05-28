const asyncHandler = (requestHandler) => {
    (req, res, next) => {
        Promise.resolve(requestHandler(req, res, next)).catch((error) => next(error));
    }
}
export {asyncHandler}


// Try Catch block for async functions in express routes
// const asyncHandler = (fn) => async(req, res, next)=>{
//     try {
//         await fn(req, res, next);
//     } catch (error) {
//         res.status(error.code || 500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };