'use strict';
const {create}=require('./_handlers.cjs');
const createHandler=deps=>create('request',deps);
module.exports=createHandler();module.exports.createHandler=createHandler;
