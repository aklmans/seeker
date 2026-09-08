// @ts-check
import {openModal} from '../shell/modal.js';
import {escapeHTML} from './content.js';
/** Body and footer are platform-authored markup; external text must already be escaped.
 * @param {string} title @param {string} body @param {string} [footer] @param {boolean} [wide] */
export function openCreationModal(title,body,footer='',wide=false){
  const modal=openModal(`<div class="modal-head"><h2>${escapeHTML(title)}</h2><button class="x">×</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-foot">${footer}</div>`:''}`,wide);
  modal?.classList.add('creation-modal');
  return modal;
}
