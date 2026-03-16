/**
 * Cancellation Policy Utility
 * Handles business logic for order cancellations and refunds
 */

// Constants
const FULL_REFUND_WINDOW_MINUTES = 2;
const PARTIAL_REFUND_WINDOW_MINUTES = 5;
const PARTIAL_REFUND_PERCENTAGE = 0.9; // 90%

// Statuses that allow cancellation
const CANCELLABLE_STATUSES = ['PLACED', 'ACCEPTED'];

// Statuses that don't allow cancellation
const NON_CANCELLABLE_STATUSES = ['PREPARING', 'READY', 'COMPLETED', 'REJECTED', 'CANCELLED'];

/**
 * Check if an order can be cancelled
 * @param {Object} order - Order object from database
 * @returns {Object} { canCancel: boolean, reason: string }
 */
export function canCancelOrder(order) {
  // Check if already cancelled
  if (order.status === 'CANCELLED') {
    return {
      canCancel: false,
      reason: 'Order is already cancelled'
    };
  }

  // Check if order status allows cancellation
  if (NON_CANCELLABLE_STATUSES.includes(order.status)) {
    return {
      canCancel: false,
      reason: `Order is ${order.status.toLowerCase()} and cannot be cancelled`
    };
  }

  // Check payment status
  if (order.paymentStatus !== 'SUCCEEDED') {
    return {
      canCancel: false,
      reason: 'Only paid orders can be cancelled'
    };
  }

  // Check time window
  const minutesSinceOrder = getMinutesSinceOrder(order.createdAt);
  
  if (minutesSinceOrder > PARTIAL_REFUND_WINDOW_MINUTES) {
    return {
      canCancel: false,
      reason: `Cancellation window expired (${PARTIAL_REFUND_WINDOW_MINUTES} minutes)`
    };
  }

  // Order can be cancelled
  return {
    canCancel: true,
    reason: 'Order can be cancelled'
  };
}

/**
 * Calculate refund amount based on cancellation time
 * @param {Object} order - Order object from database
 * @returns {Object} { refundAmount: number, refundPercentage: number }
 */
export function calculateRefundAmount(order) {
  const minutesSinceOrder = getMinutesSinceOrder(order.createdAt);
  
  // Full refund within 2 minutes
  if (minutesSinceOrder <= FULL_REFUND_WINDOW_MINUTES) {
    return {
      refundAmount: order.totalAmount,
      refundPercentage: 100
    };
  }
  
  // 90% refund between 2-5 minutes
  if (minutesSinceOrder <= PARTIAL_REFUND_WINDOW_MINUTES) {
    return {
      refundAmount: order.totalAmount * PARTIAL_REFUND_PERCENTAGE,
      refundPercentage: 90
    };
  }
  
  // No refund after 5 minutes
  return {
    refundAmount: 0,
    refundPercentage: 0
  };
}

/**
 * Get user-friendly cancellation message
 * @param {Object} order - Order object from database
 * @returns {Object} Cancellation info for display
 */
export function getCancellationMessage(order) {
  const { canCancel, reason } = canCancelOrder(order);
  
  if (!canCancel) {
    return {
      canCancel: false,
      message: reason,
      refundAmount: 0,
      refundPercentage: 0
    };
  }
  
  const { refundAmount, refundPercentage } = calculateRefundAmount(order);
  const minutesSinceOrder = getMinutesSinceOrder(order.createdAt);
  const minutesRemaining = PARTIAL_REFUND_WINDOW_MINUTES - minutesSinceOrder;
  
  let message = '';
  
  if (refundPercentage === 100) {
    message = `You will receive a full refund of ${formatCurrency(refundAmount)}. You have ${Math.ceil(minutesRemaining)} minutes remaining to cancel.`;
  } else if (refundPercentage === 90) {
    message = `You will receive ${refundPercentage}% refund (${formatCurrency(refundAmount)}). Cancellation charges apply after 2 minutes.`;
  } else {
    message = `No refund available. Cancellation window expired.`;
  }
  
  return {
    canCancel: true,
    message,
    refundAmount,
    refundPercentage,
    minutesRemaining: Math.max(0, minutesRemaining)
  };
}

/**
 * Get cancellation policy text for display
 * @returns {Array} Array of policy points
 */
export function getCancellationPolicy() {
  return [
    `Full refund if cancelled within ${FULL_REFUND_WINDOW_MINUTES} minutes`,
    `${PARTIAL_REFUND_PERCENTAGE * 100}% refund if cancelled within ${PARTIAL_REFUND_WINDOW_MINUTES} minutes`,
    'No refund after 5 minutes or if order is being prepared',
    'Refund will be processed to your original payment method within 5-10 business days'
  ];
}

/**
 * Helper: Get minutes since order was placed
 * @param {Date|string} createdAt - Order creation timestamp
 * @returns {number} Minutes since order
 */
function getMinutesSinceOrder(createdAt) {
  const orderTime = new Date(createdAt);
  const now = new Date();
  const diffMs = now - orderTime;
  return Math.floor(diffMs / (1000 * 60));
}

/**
 * Helper: Format currency (INR)
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(amount);
}

/**
 * Validate cancellation request
 * @param {Object} order - Order object
 * @param {string} userId - User ID making the request
 * @returns {Object} Validation result
 */
export function validateCancellationRequest(order, userId) {
  // Check if user owns the order
  if (order.userId !== userId) {
    return {
      valid: false,
      error: 'You can only cancel your own orders'
    };
  }

  // Check if order can be cancelled
  const { canCancel, reason } = canCancelOrder(order);
  
  if (!canCancel) {
    return {
      valid: false,
      error: reason
    };
  }

  return {
    valid: true,
    error: null
  };
}
