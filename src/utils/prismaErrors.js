/**
 * Maps Prisma error codes to human-readable error messages and appropriate HTTP status codes.
 * 
 * @param {Error} error - The error object caught in a try-catch block
 * @returns {Object} - Object containing statusCode and error message
 */
export const mapPrismaError = (error) => {
  // If it's not a Prisma known request error, return default 500
  if (error.code === undefined || !error.code.startsWith('P')) {
    return {
      statusCode: 500,
      message: 'An unexpected internal server error occurred'
    };
  }

  switch (error.code) {
    case 'P2002': {
      // Unique constraint failed
      const target = error.meta?.target || 'field';
      return {
        statusCode: 409,
        message: `Unique constraint failed on the ${target}`
      };
    }
    case 'P2003': {
      // Foreign key constraint failed
      const field = error.meta?.field_name || 'reference';
      return {
        statusCode: 400,
        message: `Invalid reference provided: ${field} does not exist`
      };
    }
    case 'P2025': {
      // Record to update not found
      return {
        statusCode: 404,
        message: 'The requested record was not found'
      };
    }
    case 'P2000': {
      // The provided value for the column is too long
      return {
        statusCode: 400,
        message: 'The provided value is too long for one of the fields'
      };
    }
    case 'P2005':
    case 'P2006': {
      // The value stored in the database for the field is invalid
      return {
        statusCode: 400,
        message: 'Invalid data provided for one or more fields'
      };
    }
    default:
      return {
        statusCode: 500,
        message: `Database error (${error.code})`
      };
  }
};
