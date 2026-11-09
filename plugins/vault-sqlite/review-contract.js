// Browser-safe vocabulary: assistance describes an experience, not an outcome.
export const REVIEW_SUPPORT_LABELS = Object.freeze({independent:'无提示',hint:'有提示',explanation:'看过讲解',unknown:'不确定'});
export const REVIEW_INTERVALS = Object.freeze([1,3,7,16,35]);
export const CARD_TYPES = Object.freeze(new Set(['card','concept','method','exercise']));
export const isCardType = type => CARD_TYPES.has(type);
export const isReviewDocument=(type,path='')=>isCardType(type)||type==='diary'||(!type||type==='note')&&path.startsWith('日记/')&&/\.md$/i.test(path);
