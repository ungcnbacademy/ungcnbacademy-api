const Joi = require('joi')
const mongoose = require('mongoose')
const { Module, ModuleReview, Progress, Course } = require('../models')
const { AppError } = require('../utils/errors')

// Validation schema
const reviewSchema = Joi.object({
  rating: Joi.number().required().min(1).max(5),
  feedback: Joi.string().allow('', null),
}).options({ abortEarly: false })

// Create or update a module review
exports.createModuleReview = async (req, res, next) => {
  try {
    // Validate request body
    const { error, value } = reviewSchema.validate(req.body)
    if (error) {
      return res.status(400).json({
        status: 'error',
        errors: error.details.map((detail) => ({
          field: detail.context.key,
          message: detail.message,
        })),
      })
    }

    const { moduleId, courseId } = req.params
    const userId = req.user._id

    // Verify module exists and belongs to the course
    const module = await Module.findOne({
      _id: moduleId,
      course: courseId,
      isDeleted: false,
    })

    if (!module) {
      return next(new AppError('Module not found', 404))
    }

    // Check if user has completed the module (has progress record)
    const progress = await Progress.findOne({
      user: userId,
      course: courseId,
      module: moduleId,
    })

    if (!progress) {
      return next(new AppError('You must complete this module before reviewing it', 403))
    }

    // Create or update review
    const review = await ModuleReview.findOneAndUpdate(
      {
        user: userId,
        module: moduleId,
        course: courseId,
      },
      {
        ...value,
        user: userId,
        module: moduleId,
        course: courseId,
        isDeleted: false, // In case it was previously soft-deleted
      },
      {
        new: true,
        upsert: true,
      }
    )

    res.status(200).json({
      message: 'Module review submitted successfully',
      data: {
        id: review._id,
        rating: review.rating,
        feedback: review.feedback,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

// Get user's review for a specific module
exports.getModuleReview = async (req, res, next) => {
  try {
    const { moduleId, courseId } = req.params
    const userId = req.user._id

    const review = await ModuleReview.findOne({
      user: userId,
      module: moduleId,
      course: courseId,
      isDeleted: false,
    })

    if (!review) {
      return res.status(200).json({
        message: 'No review found',
        data: null,
      })
    }

    res.status(200).json({
      message: 'Module review fetched successfully',
      data: {
        id: review._id,
        rating: review.rating,
        feedback: review.feedback,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

// Delete a module review (soft delete)
exports.deleteModuleReview = async (req, res, next) => {
  try {
    const { moduleId, courseId } = req.params
    const userId = req.user._id

    const review = await ModuleReview.findOneAndUpdate(
      {
        user: userId,
        module: moduleId,
        course: courseId,
        isDeleted: false,
      },
      { isDeleted: true },
      { new: true }
    )

    if (!review) {
      return next(new AppError('Review not found', 404))
    }

    res.status(200).json({
      message: 'Module review deleted successfully',
    })
  } catch (error) {
    next(error)
  }
}

// Delete a specific module review (admin only)
exports.deleteReviewAdmin = async (req, res, next) => {
  try {
    const { moduleId, courseId, reviewId } = req.params;

    // Verify module exists
    const module = await Module.findOne({
      _id: moduleId,
      course: courseId,
      isDeleted: false,
    });
    
    if (!module) {
      return next(new AppError('Module not found', 404));
    }

    // Find and soft delete the review
    const review = await ModuleReview.findOneAndUpdate(
      {
        _id: reviewId,
        module: moduleId,
        course: courseId,
        isDeleted: false,
      },
      { isDeleted: true },
      { new: true }
    );

    if (!review) {
      return next(new AppError('Review not found', 404));
    }

    res.status(200).json({
      message: 'Module review deleted successfully by admin',
    });
  } catch (error) {
    next(error);
  }
};

// Get public reviews for a module (accessible to all users)
exports.getPublicModuleReviews = async (req, res, next) => {
  try {
    const { moduleId, courseId } = req.params
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 10

    // Verify module exists and belongs to the course
    const module = await Module.findOne({
      _id: moduleId,
      course: courseId,
      isDeleted: false,
    }).select('title rating')
    
    if (!module) {
      return next(new AppError('Module not found', 404))
    }

    // Get total review count
    const totalReviews = await ModuleReview.countDocuments({
      module: moduleId,
      course: courseId,
      isDeleted: false,
    })

    // Get reviews with pagination
    const reviews = await ModuleReview.find({
      module: moduleId,
      course: courseId,
      isDeleted: false,
    })
      .populate('user', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)

    // Format reviews with limited user information for privacy
    const formattedReviews = reviews.map((review) => ({
      id: review._id,
      user: {
        name: review.user.firstName, // Only include first name for privacy
      },
      rating: review.rating,
      feedback: review.feedback,
      createdAt: review.createdAt,
    }))

    // Get rating distribution
    const ratingSummary = await ModuleReview.aggregate([
      { 
        $match: { 
          module: new mongoose.Types.ObjectId(moduleId), 
          course: new mongoose.Types.ObjectId(courseId),
          isDeleted: false 
        } 
      },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ])

    // Format rating distribution (1-5 stars)
    const ratingDistribution = [1, 2, 3, 4, 5].map(rating => {
      const found = ratingSummary.find(r => r._id === rating)
      return {
        rating,
        count: found ? found.count : 0
      }
    })

    res.status(200).json({
      message: 'Module reviews fetched successfully',
      data: {
        module: {
          id: module._id,
          title: module.title,
          averageRating: module.rating || 0,
        },
        summary: {
          totalReviews,
          ratingDistribution,
        },
        reviews: formattedReviews,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalReviews / limit),
          totalReviews,
          hasNextPage: page < Math.ceil(totalReviews / limit),
          hasPrevPage: page > 1,
        },
      },
    })
  } catch (error) {
    console.error('Error fetching public module reviews:', error)
    next(error)
  }
}
// Get all reviews for a module (admin only)
exports.getAllModuleReviews = async (req, res, next) => {
  try {
    const { moduleId, courseId } = req.params
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 10

    // Verify the module exists
    const module = await Module.findOne({
      _id: moduleId,
      course: courseId,
      isDeleted: false,
    })

    if (!module) {
      return next(new AppError('Module not found', 404))
    }

    const totalReviews = await ModuleReview.countDocuments({
      module: moduleId,
      course: courseId,
      isDeleted: false,
    })

    const reviews = await ModuleReview.find({
      module: moduleId,
      course: courseId,
      isDeleted: false,
    })
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)

    const formattedReviews = reviews.map((review) => ({
      id: review._id,
      user: {
        id: review.user._id,
        name: `${review.user.firstName} ${review.user.lastName}`,
        email: review.user.email,
      },
      rating: review.rating,
      feedback: review.feedback,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    }))

    res.status(200).json({
      message: 'Module reviews fetched successfully',
      data: {
        module: {
          id: module._id,
          title: module.title,
        },
        reviews: formattedReviews,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalReviews / limit),
          totalReviews,
          hasNextPage: page < Math.ceil(totalReviews / limit),
          hasPrevPage: page > 1,
        },
      },
    })
  } catch (error) {
    next(error)
  }
}

exports.getAllReviewsAdmin = async (req, res, next) => {
  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 10
    const skip = (page - 1) * limit

    // Parse filter parameters (optional)
    const filters = {}

    if (req.query.rating) {
      filters.rating = parseInt(req.query.rating)
    }

    if (req.query.courseId) {
      filters.course = req.query.courseId
    }

    if (req.query.moduleId) {
      filters.module = req.query.moduleId
    }

    // For text search in feedback
    if (req.query.search) {
      filters.feedback = { $regex: req.query.search, $options: 'i' }
    }

    // Add isDeleted filter (default: show active reviews)
    if (req.query.showDeleted === 'true') {
      // Do nothing - show all reviews including deleted ones
    } else {
      filters.isDeleted = false // Default: only show active reviews
    }

    // Count total matching reviews
    const totalReviews = await ModuleReview.countDocuments(filters)

    // Get reviews with pagination and populate references
    const reviews = await ModuleReview.find(filters)
      .populate('user', 'firstName lastName email')
      .populate('module', 'title')
      .populate('course', 'title')
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)

    // Format the response data
    const formattedReviews = reviews.map((review) => ({
      id: review._id,
      rating: review.rating,
      feedback: review.feedback,
      isDeleted: review.isDeleted,
      user: {
        id: review.user._id,
        name: `${review.user.firstName} ${review.user.lastName}`,
        email: review.user.email,
      },
      module: {
        id: review.module._id,
        title: review.module.title,
      },
      course: {
        id: review.course._id,
        title: review.course.title,
      },
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    }))

    // Return the response
    res.status(200).json({
      message: 'All reviews fetched successfully',
      data: {
        reviews: formattedReviews,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalReviews / limit),
          totalReviews,
          hasNextPage: page < Math.ceil(totalReviews / limit),
          hasPrevPage: page > 1,
        },
        filters: Object.keys(filters).length > 0 ? filters : 'None',
      },
    })
  } catch (error) {
    console.error('Error fetching all reviews:', error)
    next(error)
  }
}