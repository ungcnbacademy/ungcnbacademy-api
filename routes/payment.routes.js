const express = require('express')
const { protect } = require('../middleware/auth')
const validateMongoId = require('../middleware/validateMongoId')

const { initiateCoursePayment, initiateModulePayment, verifyPayment, getPaymentHistory, getPaymentDetails } = require('../controllers/payment.controller')

const router = express.Router({ mergeParams: true })

// Payment initiation routes
router.post('/courses/:courseId/initiate-course', protect, validateMongoId, initiateCoursePayment)

router.post('/courses/:courseId/initiate-module', protect, validateMongoId, initiateModulePayment)

// Payment verification route
router.get('/verify', verifyPayment)

// Payment history routes
router.get('/history', protect, getPaymentHistory)
router.get('/:paymentId', protect, validateMongoId, getPaymentDetails)

module.exports = router
