/**
 * N8n Code Node: Extract Token Addresses
 * 
 * This code extracts token addresses from JSON data provided by the previous node.
 * It handles the example format provided by the user.
 */

// Initialize the result object
const result = {
  token_addresses: []
};

try {
  // Get the input data
  const inputData = $input.first().json.output;
  console.log('Input data type:', typeof inputData);
  
  // Parse the input if it's a string
  let parsedData;
  if (typeof inputData === 'string') {
    try {
      parsedData = JSON.parse(inputData);
    } catch (e) {
      console.log('Error parsing JSON string:', e.message);
      return result; // Return empty result if parsing fails
    }
  } else {
    parsedData = inputData;
  }
  
  // Check if we have the expected data structure
  if (parsedData && typeof parsedData === 'object') {
    // First try to get token_addresses array if it exists
    if (Array.isArray(parsedData.token_addresses)) {
      result.token_addresses = parsedData.token_addresses;
    }
    // If not, try to extract from high_potential_tokens
    else if (Array.isArray(parsedData.high_potential_tokens)) {
      result.token_addresses = parsedData.high_potential_tokens.map(token => token.token_address);
    }
  }
} catch (error) {
  // Log any errors
  console.error('Error processing data:', error.message);
}

// Log the final result
console.log('Final result:', result);

// Return the extracted token addresses
return result;
