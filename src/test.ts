import {
  fetchTransactionDetails,
  createSwapTransaction,
  getRugCheckConfirmed,
  fetchAndSaveSwapDetails,
} from "./transactions";

(async () => {
  const testId = null;
  if (testId) {
    const tx = await fetchTransactionDetails(testId);
    console.log(tx);
  }
})();

(async () => {
  const testId = null;
  if (testId) {
    const tx = await createSwapTransaction(
      "So11111111111111111111111111111111111111112",
      testId
    );
    console.log(tx);
  }
})();

(async () => {
  const testId = null;
  if (testId) {
    const tx = await getRugCheckConfirmed(testId);
    console.log(tx);
  }
})();

(async () => {
  const testId =
    "3SQXLu2UFTN7mfPqei2aurPwVu7jzvvzNkj7WiwTT25pkHijVozVwYavuurQu1B63V6nWJ4o2dSQuMEPMczmq82q";
  if (testId) {
    const tx = await fetchAndSaveSwapDetails(testId);
    console.log(tx);
  }
})();
