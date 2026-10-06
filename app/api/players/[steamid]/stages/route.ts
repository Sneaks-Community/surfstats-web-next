import { getPlayerStageTimesFromCache, getIncompleteStagesFromCache } from '@/lib/player-profile-cache';
import { playerTimesHandler } from '../times-handler';

export const GET = playerTimesHandler('stage', getPlayerStageTimesFromCache, getIncompleteStagesFromCache);
