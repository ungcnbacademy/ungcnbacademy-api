const { User, Course, Progress } = require('../models')
const { AppError } = require('../utils/errors')
const Joi = require('joi')
const { uploadToS3, deleteFromS3 } = require('../utils/s3')

// Moved validation schema inside controller
const updateProfileSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).messages({
    'string.min': 'First name must be at least 2 characters long',
    'string.max': 'First name cannot exceed 50 characters',
  }),
  lastName: Joi.string().trim().min(2).max(50).messages({
    'string.min': 'Last name must be at least 2 characters long',
    'string.max': 'Last name cannot exceed 50 characters',
  }),
  phoneNumber: Joi.string()
    .pattern(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/)
    .messages({
      'string.pattern.base': 'Please provide a valid phone number',
    }),
}).options({ abortEarly: false })


exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-password -verificationToken -resetPasswordToken -resetPasswordExpires')

    if (!user) {
      return next(new AppError('User not found', 404))
    }

    res.status(200).json({
      message: 'Profile retrieved successfully',
      data: user,
    })
  } catch (error) {
    next(error)
  }
}

exports.updateProfile = async (req, res, next) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body)
    if (error) {
      return res.status(400).json({
        status: 'error',
        errors: error.details.map((detail) => ({
          field: detail.context.key,
          message: detail.message,
        })),
      })
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { ...value },
      {
        new: true,
        runValidators: true,
        select: '-password -verificationToken -resetPasswordToken -resetPasswordExpires',
      }
    )

    if (!updatedUser) {
      return next(new AppError('User not found', 404))
    }

    res.status(200).json({
      message: 'Profile updated successfully',
      data: updatedUser,
    })
  } catch (error) {
    next(error)
  }
}

exports.uploadProfileImage = async (req, res, next) => {
  try {
    // Check if image file was provided
    if (!req.file) {
      return next(new AppError('Please provide an image file', 400))
    }

    // Check file type
    if (!req.file.mimetype.startsWith('image/')) {
      return next(new AppError('Please upload only image files', 400))
    }

    // Check file size (limit to 5MB)
    const maxSize = 5 * 1024 * 1024
    if (req.file.size > maxSize) {
      return next(new AppError('Image file too large. Maximum size is 5MB', 400))
    }

    // Find the user
    const user = await User.findById(req.user._id)
    if (!user) {
      return next(new AppError('User not found', 404))
    }

    // Store old image key for cleanup
    const oldImageKey = user.profileImageKey

    // Upload new image to S3
    // Replace spaces with hyphens in the original filename
    const sanitizedFilename = req.file.originalname.replace(/\s+/g, '-')
    const profileImageKey = `profile-images/${req.user._id}-${Date.now()}-${sanitizedFilename}`
    const profileImageUrl = await uploadToS3(req.file, profileImageKey)

    // Update user with new image details
    user.profileImage = profileImageUrl
    user.profileImageKey = profileImageKey
    await user.save()

    // Delete old image if it exists
    if (oldImageKey) {
      try {
        await deleteFromS3(oldImageKey)
      } catch (error) {
        console.error('Error deleting old profile image:', error)
        // Don't fail the request if old image deletion fails
      }
    }

    res.status(200).json({
      message: 'Profile image uploaded successfully',
      data: {
        profileImage: user.profileImage,
      },
    })
  } catch (error) {
    console.error('Error in uploadProfileImage:', error)
    next(error)
  }
}

exports.getEnrolledCourses = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate({
        path: 'enrolledCourses.course',
        select: 'title description thumbnail price rating',
        match: { isDeleted: false }
      });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Filter out null/undefined courses
    const validEnrollments = user.enrolledCourses.filter(e => e.course);

    const enrolledCourses = await Promise.all(
      validEnrollments.map(async (enrollment) => {
        const progress = await Progress.findOne({
          user: req.user._id,
          course: enrollment.course._id
        });

        return {
          course: enrollment.course,
          enrolledAt: enrollment.enrolledAt,
          progress: progress ? {
            completedLessons: progress.completedLessons?.length || 0,
            completedQuizzes: progress.completedQuizzes?.length || 0, 
            lastAccessed: progress.lastAccessed
          } : null
        };
      })
    );

    res.status(200).json({
      message: 'Enrolled courses fetched successfully',
      data: enrolledCourses 
    });

  } catch (error) {
    console.error('getEnrolledCourses error:', error);
    next(error);
  }
};

exports.getCourseProgress = async (req, res, next) => {
  try {
    const { courseId } = req.params

    // Validate if course exists
    const course = await Course.findById(courseId).populate({
      path: 'modules',
      populate: {
        path: 'lessons',
        populate: 'quiz',
      },
    })

    if (!course) {
      return next(new AppError('Course not found', 404))
    }

    // Check if user is enrolled in the course
    const isEnrolled = req.user.enrolledCourses.some((enrollment) => enrollment.course.toString() === courseId)

    if (!isEnrolled) {
      return next(new AppError('You are not enrolled in this course', 403))
    }

    const progress = await Progress.findOne({
      user: req.user._id,
      course: courseId,
    }).populate('completedLessons completedQuizzes')

    if (!progress) {
      return next(new AppError('Progress not found', 404))
    }

    // Calculate overall progress
    const totalLessons = course.modules.reduce((total, module) => total + module.lessons.length, 0)

    const progressData = {
      completedLessons: progress.completedLessons,
      completedQuizzes: progress.completedQuizzes,
      overallProgress: (progress.completedLessons.length / totalLessons) * 100,
      lastAccessed: progress.lastAccessed,
      moduleProgress: course.modules.map((module) => ({
        moduleId: module._id,
        moduleName: module.title,
        completedLessons: progress.completedLessons.filter((lesson) => module.lessons.some((l) => l._id.equals(lesson._id))).length,
        totalLessons: module.lessons.length,
      })),
    }

    res.status(200).json({
      message: 'Course progress fetched successfully',
      data: progressData,
    })
  } catch (error) {
    next(error)
  }
}
