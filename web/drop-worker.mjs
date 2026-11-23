// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import RAPIER from './vendor/rapier/rapier.mjs';
import {runDropTest} from './drop.mjs';

let ready;
self.onmessage=async({data})=>{
  const {id,...input}=data??{};
  try {
    ready??=RAPIER.init();
    await ready;
    self.postMessage({id,result:await runDropTest(RAPIER,input)});
  } catch(error) {
    self.postMessage({id,error:error.message || 'The guided drop simulation failed.'});
  }
};
