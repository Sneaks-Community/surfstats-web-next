import { getPlayerBonusTimesFromCache, getIncompleteBonusesFromCache } from '@/lib/player-profile-cache';
import { playerTimesHandler } from '../times-handler';

export const GET = playerTimesHandler('bonus', getPlayerBonusTimesFromCache, getIncompleteBonusesFromCache);
