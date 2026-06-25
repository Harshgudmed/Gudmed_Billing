/**
 * Zod validation middleware factory.
 * Usage: router.post('/', validate(myZodSchema), controller)
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: result.error.issues,
      })
    }
    req.validatedBody = result.data
    next()
  }
}
