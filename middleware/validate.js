const { AppError } = require('../utils/errors')

exports.validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body)
    if (error) {
      const message = error.details.map((detail) => detail.message).join(', ')
      return next(new AppError(message, 400))
    }
    next()
  }
}
