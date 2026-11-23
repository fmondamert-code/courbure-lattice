// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {analyzeBCC} from './mechanics.mjs';

self.onmessage = ({data}) => {
  const {id,spec,material,band} = data ?? {};
  try {
    const result = analyzeBCC(spec,material,band);
    self.postMessage({id,type:'result',result});
  } catch (error) {
    self.postMessage({id,type:'error',message:String(error?.message ?? error)});
  }
};
