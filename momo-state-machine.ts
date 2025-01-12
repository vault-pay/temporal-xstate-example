import { createMachine, assign } from 'xstate';
import { MobileMoneyContext, MobileMoneyEvent, MobileMoneyEventType } from '../../../models/states-models';

export const MomoStateMachineFactory = {
  createStateMachine: () => {
    return createMachine({
      /** @xstate-layout N4IgpgJg5mDOIC5QFsD2AjAlgGzAWVQDswBPAOk0MwBdMBDayAYgAUAlAeQGEBRAZT4B9FgEEAmnh4A5ACoBtAAwBdRKAAOqWDUxFVIAB6IAtABYAHArIA2AIwAmAMwmA7GasBWZ84c2HAGhASRAd3BzJnEwBOSOd3d0iPEIBfJIC0LFwCYnI1ACdUAGM4LUIoVnFJWUEuDjwWABkeGR4AEUUVJBANLVpdTsMEN3cyBRt3KxCHSIcrKzcAoIRxm3DIuxcTdzNQhVcUtIwcfCJSMjzC4soy0QlpGUEAMREASUa25T1u7T7QAbszExkXxOBShBLOKybBaIOxbayRGz2XwmSbmKz7EDpI5ZU7nIqwErXCp3QQyZ6SDgAVXkH06X16hD0f1iZBmrgUCgR8TsHmhCEm4XcHOFIo56NSmMOmRO5DQaBYdBIyDAhGoDzoRwgTEpfB4bEEfEpACE8M97jdKubOBwHu1Pppvoz+ogAZERpzokKbGZnKN-IFglY3bN3HYFHYbF4HBZYRisdLsmQ5agFUqVWqNbgtTq9YI2DwAIqU-j3PAiKSUkT1YTE2R2ukOhlMxBC4bOGzRTkmUbCux8oz2ZxkEx2Nag6NbFGRExxqXHRPJ1PK1XqzXa3X6-N8FgcKS60nknhUmkddSNnRO34ukyAhxTEwTf5bCaRPkPttrDZbHZ7CXx+enAAbmAuSYAAZiQVwsPkqBgaw1oPIIABqVbPO8p5dOePwGIgYyzMON4xDy7g2FEdjOHyDheMO4bONO-wdrskSzhkAHkMBoEQVBMFwewHA2oIzxSCh9RofWZ49BezYIPY0zDp4nKOO4KJmHefJBkOPgRGGngkQoEwsdiMpkHQADuGq0KUeB0IQACudDYEu6blLcVT5rwzxIa04mYZJ2EDKRMRkAxThjKG3g3ny9hWMONizPFCXxYZCanGZFlXNZdkOU5qouZaghSBw9zuTwnnebSEmOtJpEKICI76WYZhxSRnj9oiQ4TC4vhWBGynvikEqEKgEBwHo-44oslVNs6CBGEGMWRLVsLhqp3r+osRgRoCawImYu27BECTJWxFBULQDCQPafmXjhs2QmYZCLSOQr-D4qmUaEgqit94oHKxE1nPk+KEldVUzR21jdrYHI+hMWyuB9YSxN9oq-ZK-3GYuirLhmmqg9NV5LN2BGNdGT5uFMiNfeGyleL6oTHQDHHgZBpTQagsH41J4OjsM3benYsJWPTrUBvyQbWB4YYRlGMaM8ZaXaFZNn2Y52Pplz-mINOwxgrVDicg4guRWLA7kcOo46ROAJTDY8uJgUqDIGouCMBAms3QFsRDg+kQtcjgvvWLVExWM5GxPE0auHbf5zgDYGZpdDbXdVMRDvE+kJKpmxjOtuFwqOTURB4QZEXYA1JEAA */
      id: 'mobileMoney',
      initial: 'initiated',
      types: {
        context: {} as MobileMoneyContext,
        events: {} as MobileMoneyEvent,
        input: {} as MobileMoneyContext | undefined,
      },
      context: ({ input }) => ({
        transactionId: input?.transactionId ?? '',
        userId: input?.userId ?? '',
        amount: input?.amount ?? { value: 0, currency: 'USD' },
        provider: input?.provider,
        phoneNumber: input?.phoneNumber,
        proof: input?.proof,
        lastUpdated: new Date(),
      }),
      states: {
        initiated: {
          on: {
            PROCESS_PAYMENT: 'processing'
          }
        },
        processing: {
          entry: 'processPayment',
          // invoke: {
          //   src: 'processPayment',
          //   onDone: [
          //     {
          //       guard: ({event}) => (
          //         event.output === MobileMoneyEventType.PAYMENT_COMPLETED
          //       ),
          //       target: 'completed'
          //     },
          //     {
          //       guard: ({event}) => (
          //         event.output === MobileMoneyEventType.PAYMENT_FAILED
          //       ),
          //       target: 'momoPaymentFailed'
          //     }
          //   ],
          //   onError: {
          //     target: 'momoPaymentFailed',
          //     actions: 'logMessage'
          //   }
          // },
          on: {
            PAYMENT_COMPLETED: {
              target: 'completed',
            },
            PAYMENT_FAILED: {
              target: 'momoPaymentFailed',
            },
            PAYMENT_TIMEOUT: {
              target: 'momoPaymentFailed',
            }
          }
        },
        momoPaymentFailed: {
          invoke: {
            src: 'handleMomoPaymentFailedState',
            onDone: [
              {
                guard: ({event}) => (
                  event.output.eventType === MobileMoneyEventType.USER_SUBMIT_PAYMENT_PROOF
                ),
                actions: assign({
                  proof: ({event}) => event?.output.proof
                }),
                target: 'verifyingProof'
              },
              {
                guard: ({event}) => (
                  event.output.eventType === MobileMoneyEventType.USER_REQUEST_MANUAL_PAYMENT
                ),
                target: 'awaitUserManualPayment'
              },
              {
                guard: ({event}) => (
                  event.output.eventType === MobileMoneyEventType.USER_RESPONSE_TIMEOUT
                ),
                target: 'failed'
              }
            ]
          },
          on: {
            USER_SUBMIT_PAYMENT_PROOF: {
              target: 'verifyingProof',
              actions: assign({
                proof: ({event}) => event?.proof
              })
            },
            USER_REQUEST_MANUAL_PAYMENT: 'awaitUserManualPayment',
            USER_RESPONSE_TIMEOUT: 'failed'
          }
        },
        verifyingProof: {
          invoke: {
            src: 'handleVerifyingPaymentProof',
            onDone: [
              {
                guard: ({event}) => (
                  event.output.eventType === MobileMoneyEventType.PROOF_VALID
                ),
                actions: assign({
                  proof: ({event}) => event?.output.proof
                }),
                target: 'completed'
              },
              {
                guard: ({event}) => (
                  event.output.eventType === MobileMoneyEventType.PROOF_INVALID
                ),
                actions: assign({
                  proof: ({event}) => event?.output.proof
                }),
                target: 'failed'
              }
            ]
          },
          on: {
            PROOF_VALID: 'completed',
            PROOF_INVALID: 'failed'
          }
        },
        awaitUserManualPayment: {
          invoke: {
            src: 'handleVerifyingPaymentProof',
            onDone: [
              {
                guard: ({event}) => (
                  event.output.eventType === MobileMoneyEventType.PAYMENT_RECEIVED
                ),
                actions: assign({
                  proof: ({event}) => event?.output.proof
                }),
                target: 'verifyingProof'
              },
              {
                guard: ({event}) => (
                  event.output.eventType === MobileMoneyEventType.PAYMENT_NOT_RECEIVED
                ),
                target: 'failed'
              }
            ]
          },
          on: {
            PAYMENT_RECEIVED: {
              target: 'verifyingProof',
              actions: assign({
                proof: ({event}) => event?.proof
              })
            },
            PAYMENT_NOT_RECEIVED: 'failed'
          }
        },
        completed: { type: 'final' },
        failed: { type: 'final' }
      },
    });
  }
};