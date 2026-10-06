import { getPlayerMapTimesFromCache, getIncompleteMapsFromCache } from '@/lib/player-profile-cache';
import { playerTimesHandler } from '../times-handler';

export const GET = playerTimesHandler('map', getPlayerMapTimesFromCache, getIncompleteMapsFromCache);
