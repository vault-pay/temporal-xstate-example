import { proxyActivities, log, upsertSearchAttributes, setHandler, defineSignal, sleep, ApplicationFailure } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import { createActor } from 'xstate';
import {
  MomoPaymentsRequest,
  PaymentProof,
  MobileMoneyState,
  MobileMoneyEventType,
  UpdateMobileMoneyStateRequest,
  MomoLifecycleSignal,
  MobileMoneyStateStoredData,
} from '../../../models/states-models';
import { CardOrderTransaction, CardTopUpTransaction, ManualPaymentInstructionNotificationRequest, ManualPaymentInstructions, NotificationType, TransactionType, User } from '../../../models/wallet-models';
import { ActivityOptionsUtils } from '../../../utils/activity-options-utils';
import type * as firestoreActivities from '../../firestore-database/activities/all-firestore-activities';
import type * as notificationsActivities from "../../notifications/notifications-activities";
import type * as activities from './activities';
import { MomoStateMachineFactory } from '../../../factories/states-machines/mobile-money/momo-state-machine';
import { MobileMoneyProvidersHelper } from '../../../workflows/mobile-money/helpers/mobile-money-providers-helper';

const {
  fetchUserById,
} = proxyActivities<typeof firestoreActivities>(
  ActivityOptionsUtils.defaultOptions,
);

const {
  verifyMomoPaymentProof: verifyPaymentProof,
} = proxyActivities<typeof activities>(
  ActivityOptionsUtils.defaultOptions,
);

const { sendPushNotificationActivity } = proxyActivities<
  typeof notificationsActivities
>(ActivityOptionsUtils.defaultOptions);

// Signal definitions
export const submitMomoProofSignal = defineSignal<[PaymentProof]>(MomoLifecycleSignal.SUBMIT_PROOF_SIGNAL);
export const requestMomoManualPaymentSignal = defineSignal(MomoLifecycleSignal.REQUEST_MANUAL_PAYMENT_SIGNAL);
export const manualMomoPaymentConfirmationSignal = defineSignal<[PaymentProof]>(MomoLifecycleSignal.MANUAL_PAYMENT_CONFIRMATION_SIGNAL);


export async function MomoPaymentsMachineWorkflow(
  request: MomoPaymentsRequest,
): Promise<MobileMoneyStateStoredData> {

  const type = request.cardTransaction.transactionType;
  const phoneNumber = type === TransactionType.CARD_TOP_UP ? (request.cardTransaction as CardTopUpTransaction).fromPhoneNumber : (request.cardTransaction as CardOrderTransaction).phoneNumber;
  const stateRequest: UpdateMobileMoneyStateRequest = {
    userId: request.userId,
    transactionId: request.transactionId,
    amount: request.amount,
    provider: request.provider,
    phoneNumber: phoneNumber,
    eventType: MobileMoneyEventType.PROCESS_PAYMENT
  }

  const user = await fetchUserById(stateRequest.userId);
  
  upsertSearchAttributes({ 
    ...(user.id && { userId: [user.id] }), 
    ...(user.phone_number && { userPhoneNumber: [user.phone_number] }), 
    ...(user.kycUserDetails?.fullName && { userFullName: [user.kycUserDetails.fullName] }),
    ...(stateRequest.transactionId && { transactionId: [stateRequest.transactionId] }),
  });

  const paymentMachine = MomoStateMachineFactory.createStateMachine();
  
  const machine = paymentMachine.provide({
    // actors are entities that can communicate with the machine actor.
    // actors: {
    //   verifyPaymentProof: fromPromise(({ input }) => {
    //     return verifyPaymentProof(stateRequest, input.proof);
    //   }),
    //   processPayment: fromPromise(async ({ input }) => {
    //     console.log('Processing payment', input);
    //     log.info('Processing payment', { input });
    //     const response = await handleProviderPayment(request);
    //     log.info('Payment processed', { response });
    //     return response;
    //   }),
    //   handleMomoPaymentFailedState: fromPromise(async ({}) => {
    //     await notifyUserOfPaymentFailed(stateRequest, user);
          
    //     const userResponse = await Promise.race([
    //       waitForProofSubmission(),
    //       waitForManualPaymentRequest(),
    //       timeout('2m')
    //     ]);

    //     // Use self to send events to the machine
    //     // self.send({ 
    //     //   type: userResponse.eventType,
    //     // });

    //     // or return an object to send events to the machine in invoke
    //     return {
    //       eventType: userResponse.eventType,
    //       proof: 'proof' in userResponse ? userResponse.proof : undefined
    //     }
    //   }),
    //   handleVerifyingPaymentProof: fromPromise(async ({input}) => {
    //     if (!input.proof) {
    //       throw ApplicationFailure.nonRetryable('Missing proof details', 'MISSING_PROOF');
    //     }
    //     const isValid = await verifyPaymentProof(stateRequest, input.proof);
    //     return {
    //       eventType: isValid ? MobileMoneyEventType.PROOF_VALID : MobileMoneyEventType.PROOF_INVALID
    //     };
    //   }),
    //   handleAwaitingManualPaymentInstructions: fromPromise(async () => {
    //     await handleManualPaymentInstructions(stateRequest, user);
    //     const userResponse = await Promise.race([
    //       waitForManualPaymentConfirmation(),
    //       sleep('2m')
    //     ]);
    //     return {
    //       eventType: userResponse ? MobileMoneyEventType.PAYMENT_RECEIVED : MobileMoneyEventType.PAYMENT_NOT_RECEIVED,
    //       proof: userResponse ? userResponse.proof : undefined
    //     }
    //   }),
    //   sendEventExample: fromPromise(async ({self}) => {
    //     self.send({ 
    //       type: MobileMoneyEventType.PAYMENT_RECEIVED,
    //     });
    //   }),
    // },
    // which are conditions that determine whether a transition should be taken.
    guards: {
      isPaymentCompleted: ({ event }) => {
        return event.type === MobileMoneyEventType.PAYMENT_COMPLETED;
      },
    },
    // actions are fire-and-forget side-effects.
    actions: {
      doSomething: () => {
        console.log('Doing something!');
      },
      logMessage: ({context, event}) => {
        log.error("State machine error:", { 
          // error: event.error,
          context,
          currentState: event.type
        });
      },
      processPayment: async ({context, self}) => {
        console.log('Processing payment', context);
        log.info('Processing payment', { context });
        const eventType = await handleProviderPayment(request);
        log.info('Payment processed', { eventType });
        self.send({ 
          type: eventType,
        });
      },
      handleMomoPaymentFailedState: async ({self}) => {
        await notifyUserOfPaymentFailed(stateRequest, user);
          
        const userResponse = await Promise.race([
          waitForProofSubmission(),
          waitForManualPaymentRequest(),
          timeout('2m')
        ]);

        self.send({ 
          type: userResponse.eventType,
        });
      },
      handleVerifyingPaymentProof: async ({event, self}) => {
        if (!event.proof) {
          throw ApplicationFailure.nonRetryable('Missing proof details', 'MISSING_PROOF');
        }
        const isValid = await verifyPaymentProof(stateRequest, event.proof);
        self.send({ 
          type: isValid ? MobileMoneyEventType.PROOF_VALID : MobileMoneyEventType.PROOF_INVALID
        });
      },
      handleAwaitingManualPaymentInstructions: async ({self}) => {
        await handleManualPaymentInstructions(stateRequest, user);
        const userResponse = await Promise.race([
          waitForManualPaymentConfirmation(),
          sleep('2m')
        ]);
        self.send({ 
          type: userResponse ? MobileMoneyEventType.PAYMENT_RECEIVED : MobileMoneyEventType.PAYMENT_NOT_RECEIVED,
          proof: userResponse ? userResponse.proof : undefined
        });
      },
    },
  });

  const actor = createActor(machine, {
    input: {
      transactionId: stateRequest.transactionId,
      userId: stateRequest.userId,
      amount: stateRequest.amount,
      provider: stateRequest.provider,
      phoneNumber: stateRequest.phoneNumber,
      proof: stateRequest.proof,
      lastUpdated: new Date(),
    },
  });

  // actor.start();
  // actor.send({ type: MobileMoneyEventType.PROCESS_PAYMENT });

  actor.start();
  log.info("Sending initial event");
  actor.send({ type: MobileMoneyEventType.PROCESS_PAYMENT });
  log.info("Initial state after event", {
    state: actor.getSnapshot().value
  });
  
  // setHandler(submitMomoProofSignal, (proof) => {
  //   actor.send({ type: MobileMoneyEventType.USER_SUBMIT_PAYMENT_PROOF, proof });
  // });

  // setHandler(requestMomoManualPaymentSignal, () => {
  //   actor.send({ type: MobileMoneyEventType.USER_REQUEST_MANUAL_PAYMENT });
  // });

  // setHandler(manualMomoPaymentConfirmationSignal, (proof: PaymentProof) => {
  //   actor.send({ type: MobileMoneyEventType.PAYMENT_RECEIVED, proof });
  // });

  await new Promise<void>((resolve) => {
    actor.subscribe((state) => {
      log.info("State machine state", {state});
      if (state.status === 'done') {
        resolve();
      }
    });
  });

  // await new Promise<void>((resolve) => {
  //   actor.subscribe({
  //     next(snapshot) {
  //       log.info("State machine snapshot", {snapshot});
  //     },
  //     error(err: any) {
  //       log.info('Error processing new mobile money payment event', {
  //         transactionId: stateRequest.transactionId,
  //         eventType: stateRequest.eventType,
  //         error: err,
  //       });
  //       resolve();
  //     },
  //     complete() {
  //       resolve();
  //     },
  //   });
  // });

  const snapshot = actor.getSnapshot();
  return {
    snapshot,
    stateContext: {
      state: snapshot.value as unknown as MobileMoneyState,
      context: snapshot.context,
    },
  };
}


async function handleProviderPayment(request: MomoPaymentsRequest): Promise<MobileMoneyEventType> {  
  try {
    return await MobileMoneyProvidersHelper.processMobileMoneyPayment({
      amount: request.amount,
      user: request.user,
      cardTransactionRecord: request.cardTransaction
    });
  } catch (error: any) {
    log.error('Provider payment failed:', error);
    return MobileMoneyEventType.PAYMENT_FAILED;
  }
}

async function notifyUserOfPaymentFailed(
  request: UpdateMobileMoneyStateRequest,
  user: User,
): Promise<void> {
  try {
    await sendPushNotificationActivity({
      notificationType: NotificationType.MANUAL_VERIFICATION_REQUIRED,
      user: user,
    });

    // TODO: Add email, whatsApp, SMS notifications

    log.info('Sent manual verification notification', { transactionId: request.transactionId });
  } catch (error) {
    log.error('Failed to notify user', { 
      transactionId: request.transactionId,
      error 
    });
  }
}

function waitForProofSubmission(): Promise<{ eventType: MobileMoneyEventType, proof: PaymentProof }> {
  return new Promise((resolve) => {
    setHandler(submitMomoProofSignal, (proof) => {
      resolve({ 
        eventType: MobileMoneyEventType.USER_SUBMIT_PAYMENT_PROOF, 
        proof 
      });
    });
  });
}

function waitForManualPaymentRequest(): Promise<{ eventType: MobileMoneyEventType }> {
  return new Promise((resolve) => {
    setHandler(requestMomoManualPaymentSignal, () => {
      resolve({ 
        eventType: MobileMoneyEventType.USER_REQUEST_MANUAL_PAYMENT 
      });
    });
  });
}

function waitForManualPaymentConfirmation(): Promise<{proof: PaymentProof}> {
  return new Promise((resolve) => {
    setHandler(manualMomoPaymentConfirmationSignal, (proof: PaymentProof) => {
      resolve({proof});
    });
  });
}

async function timeout(duration: Duration): Promise<{ eventType: MobileMoneyEventType }> {
  await sleep(duration);
  return { eventType: MobileMoneyEventType.USER_RESPONSE_TIMEOUT };
}

async function handleManualPaymentInstructions(
  request: UpdateMobileMoneyStateRequest,
  user: User,
): Promise<void> {
  try {
    const instructions: ManualPaymentInstructions = {
      accountName: 'VaultPay Limited',
      accountNumber: '1234567890',
      paymentReference: request.transactionId,
      instructions: [
        'Please make payment within 24 hours',
        'Include transaction ID as payment reference',
        'Keep payment proof for verification'
      ],
      validityPeriod: '24 hours',
      supportContact: 'support@vaultpay.com',
      additionalNotes: 'Contact support if you need assistance'
    };

    await sendPushNotificationActivity({
      notificationType: NotificationType.MANUAL_PAYMENT_INSTRUCTIONS,
      user: user,
      totalAmount: request.amount,
      merchantName: request.provider,
      additionalData: instructions
    } as ManualPaymentInstructionNotificationRequest);

    log.info('Sent manual payment instructions', { transactionId: request.transactionId });
  } catch (error) {
    log.error('Failed to handle manual payment instructions', { 
      transactionId: request.transactionId,
      error 
    });
    throw error;
  }
}
