# temporal-xstate-example

- [Using X-state V5](https://stately.ai/docs/migration)


- I get this error below when a child workflow fails as part of the state machine flow

```
({ input }) => ({
                transactionId: input?.transactionId ?? '',
                userId: input?.use...<omitted>...}) could not be cloned.
```

| Worklfow Execution |
| --- |
|  <img width="1860" alt="Screenshot 2025-01-12 at 1 54 34 PM" src="https://github.com/user-attachments/assets/67e9643b-768b-45eb-b03b-e299f8ed2c83" /> |


| Worklfow Error |
| --- |
| <img width="1766" alt="Screenshot 2025-01-12 at 1 54 50 PM" src="https://github.com/user-attachments/assets/fdd66aba-e376-41ee-a7a7-2e8509ac91c5" /> |
