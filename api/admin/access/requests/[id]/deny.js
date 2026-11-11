'use strict';
const {create}=require('../../../../access/_handlers.cjs');
const createHandler=deps=>create('deny',deps);
module.exports=createHandler();module.exports.createHandler=createHandler;
