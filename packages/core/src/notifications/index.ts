export {
  buildDedupeKey,
  parseDedupeKey,
  dayBucketMadrid,
} from './dedupe';
export type { NotificationType, NotificationChannel } from './dedupe';

export {
  pushPayloadFromNotificationRow,
  decideNotificationOutcome,
} from './push-drain';
export type {
  PushPayload as DrainPushPayload,
  SendOutcome,
  NotificationFinalStatus,
} from './push-drain';

export { formatGoalPush, resolveGoalRecipients } from './goal-push';
export type { GoalPushInput, GoalPushMessage } from './goal-push';

export { mergeChannelOutcomes, sendChannelIsolated } from './multi-channel';
export type { ChannelResult } from './multi-channel';

export {
  nativeHrefForNotification,
  resourceIdForNotification,
} from './native-route';
export type { NativeRouteTarget } from './native-route';

export { notificationFeedText } from './feed-text';
export type { FeedTextTranslate } from './feed-text';

export {
  getNotificationFeedFromClient,
  getNotificationsPageFromClient,
  getUnreadNotificationsFeedFromClient,
  getUnreadNotificationsCountFromClient,
  markNotificationsReadFromClient,
  markNotificationReadFromClient,
  markAllNotificationsReadFromClient,
  FEED_LIMIT,
  NOVEDADES_PAGE_SIZE,
  UNREAD_FEED_LIMIT,
  type NotificationFeedRow,
} from './feed';

export {
  expoDataFromNotification,
  buildExpoMessages,
  isDeviceNotRegistered,
  tallyExpoTickets,
} from './expo';
export type {
  ExpoNotificationData,
  ExpoPushContent,
  ExpoPushMessage,
  ExpoSendCounts,
} from './expo';
